# 견적노트

도로명주소를 기준으로 건축물대장 공공데이터를 조회해 평수를 확인하고 청소견적을 알아볼 수 있는 Vercel 앱입니다.

## 환경변수

- `JUSO_KEY`: 도로명주소 API 승인키
- `BLD_KEY`: 건축물대장 API 서비스키
- `SUPABASE_URL`: Supabase 프로젝트 URL
- `SUPABASE_ANON_KEY`: Supabase anon public 키
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service_role 키
- `KAKAO_MAP_JS_KEY`: Kakao Developers JavaScript 키
- `GOOGLE_ADSENSE_CLIENT`: Google AdSense 게시자 ID (`ca-pub-...`)
- `GOOGLE_ADSENSE_SLOT_TOP`: 검색창 아래 상단 광고 단위 슬롯 ID

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포

새 GitHub 저장소와 새 Vercel 프로젝트에 연결해서 배포하세요. 기존 `sarangkim/area-checker-v2` 저장소나 기존 Vercel 프로젝트와 연결하지 마세요.

### 커스텀 도메인

Vercel 프로젝트에 `area.happycleaning.co.kr`을 추가한 뒤 DNS에서 `area` CNAME을 Vercel이 안내하는 값으로 연결하세요. 일반적으로 서브도메인은 `cname.vercel-dns.com`을 사용합니다.

도메인을 바꾸면 Supabase Auth Site URL/Redirect URLs, Kakao Developers Web 플랫폼 도메인, Google AdSense 사이트 설정도 새 주소로 함께 갱신해야 합니다.

## Supabase 메모 저장

Supabase SQL Editor에서 `supabase-schema.sql`을 한 번 실행한 뒤, Vercel 환경변수에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 추가하세요. 공유 메모는 로그인 없이 보기 링크로 열람되고, 수정 권한은 작성 브라우저에 저장되는 수정 토큰으로 처리됩니다.

## 로그인

Supabase Auth를 사용합니다. 이메일 매직링크와 Google 로그인을 지원합니다. Google 로그인은 Supabase Authentication Providers에서 Google을 활성화하고, Supabase가 안내하는 callback URL을 Google Cloud OAuth 클라이언트의 승인된 리디렉션 URI에 등록해야 합니다. Supabase URL Configuration의 Site URL은 `https://area.happycleaning.co.kr`, Redirect URLs는 `https://area.happycleaning.co.kr/*`로 설정하세요.

## 현장 견적 요청

Supabase SQL Editor에서 `field-requests-schema.sql`을 실행하면 현장 견적 요청 MVP가 활성화됩니다. 공개 목록에는 동 단위 공개 위치, 청소 종류, 공간 유형, 보상 조건만 표시하고, 상세 주소는 신청 승인 이후 운영 정책에 따라 공개하는 구조로 확장합니다.

## 카카오맵

Kakao Developers에서 Web 플랫폼 도메인 `https://area.happycleaning.co.kr`을 등록하고, Kakao Map API를 활성화한 뒤 JavaScript 키를 Vercel 환경변수 `KAKAO_MAP_JS_KEY`로 추가하세요. 키가 없으면 앱은 지도 대신 카카오맵 검색 링크만 표시합니다.
