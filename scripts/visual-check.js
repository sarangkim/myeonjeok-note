const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseUrl = process.env.CHECK_URL || "http://127.0.0.1:3000/";
const outDir = path.join(process.cwd(), "playwright-screenshots");

const viewports = [
  { name: "iphone6", width: 375, height: 667 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

async function launchBrowser() {
  const attempts = [
    { channel: "chrome" },
    { channel: "msedge" },
    {},
  ];
  let lastError;
  for (const options of attempts) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function overlap(a, b) {
  if (!a || !b) return false;
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

async function inspect(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const selectors = {
      app: ".app",
      topbar: ".topbar",
      brand: ".brand",
      logo: ".brand-logo",
      title: ".brand h1",
      menu: "#mainMenuButton",
      install: "#installAppBtn",
      account: "#accountButton",
      workspace: ".workspace",
      sidePanel: ".note-panel:not([hidden]), #estimatePanel:not([hidden]), #boardPanel:not([hidden]), #requestsPanel:not([hidden])",
    };
    const boxes = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, rect(selector)]));
    return {
      titleText: document.querySelector(".brand h1")?.textContent || "",
      installText: document.querySelector("#installAppBtn")?.textContent || "",
      innerWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
      horizontalOverflow: document.body.scrollWidth > window.innerWidth + 2,
      mobileMedia: window.matchMedia("(max-width: 640px)").matches,
      oldMobileMedia: window.matchMedia("(max-width: 860px)").matches,
      workspaceColumns: getComputedStyle(document.querySelector(".workspace")).gridTemplateColumns,
      boxes,
    };
  });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const report = [];

  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: viewport.width <= 430,
      hasTouch: viewport.width <= 430,
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outDir, `${viewport.name}-home.png`), fullPage: false });

    const beforeMenu = await inspect(page);
    await page.click("#mainMenuButton");
    await page.screenshot({ path: path.join(outDir, `${viewport.name}-menu.png`), fullPage: false });
    const menuBox = await page.locator("#mainMenu").boundingBox().catch(() => null);

    report.push({
      ...viewport,
      screenshots: [`${viewport.name}-home.png`, `${viewport.name}-menu.png`],
      metrics: beforeMenu,
      menuBox: menuBox && Object.fromEntries(Object.entries(menuBox).map(([key, value]) => [key, Math.round(value)])),
      issues: [
        beforeMenu.horizontalOverflow ? "horizontal overflow" : null,
        viewport.width >= 641 && beforeMenu.mobileMedia ? "tablet/desktop matched mobile media" : null,
        menuBox && menuBox.x < -1 ? "menu is off-screen left" : null,
        menuBox && menuBox.x + menuBox.width > viewport.width + 1 ? "menu is off-screen right" : null,
      ].filter(Boolean),
    });
    await page.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})();
