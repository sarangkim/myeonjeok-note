const fs = require("fs");
const http = require("http");
const path = require("path");
const url = require("url");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

loadDotenv(path.join(ROOT, ".env"));
loadDotenv(path.join(ROOT, ".env.local"));

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  req.query = parsed.query || {};

  if (parsed.pathname.startsWith("/api/")) {
    return handleApi(req, res, parsed.pathname);
  }

  return serveStatic(res, parsed.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Local dev server running at http://${HOST}:${PORT}`);
});

function handleApi(req, res, pathname) {
  const apiName = pathname.slice("/api/".length).replace(/[^a-z-]/g, "");
  const apiPath = path.join(ROOT, "api", `${apiName}.js`);

  if (!apiName || !fs.existsSync(apiPath)) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "API route not found." }));
    return;
  }

  try {
    const handler = require(apiPath);
    return Promise.resolve(handler(req, makeVercelResponse(res))).catch((error) => {
      sendError(res, error);
    });
  } catch (error) {
    sendError(res, error);
  }
}

function serveStatic(res, pathname) {
  const cleanPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(ROOT, cleanPath);

  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    res.setHeader("content-type", contentType(filePath));
    res.end(data);
  });
}

function makeVercelResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (data) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
    return res;
  };

  return res;
}

function sendError(res, error) {
  if (res.headersSent) {
    res.end();
    return;
  }

  res.statusCode = 500;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    ok: false,
    message: error && error.message ? error.message : String(error),
  }));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".xml") return "application/xml; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".webmanifest") return "application/manifest+json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}
