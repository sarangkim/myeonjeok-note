# 면적노트

도로명주소를 기준으로 건축물대장 공공데이터를 조회해 층, 호, 전유면적, 공용면적, 합계 면적을 확인하는 Vercel 앱입니다.

## 환경변수

- `JUSO_KEY`: 도로명주소 API 승인키
- `BLD_KEY`: 건축물대장 API 서비스키
- `SUPABASE_URL`: Supabase 프로젝트 URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service_role 키
- `KAKAO_MAP_JS_KEY`: Kakao Developers JavaScript 키

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포

새 GitHub 저장소와 새 Vercel 프로젝트에 연결해서 배포하세요. 기존 `sarangkim/area-checker-v2` 저장소나 기존 Vercel 프로젝트와 연결하지 마세요.

## Supabase 메모 저장

Supabase SQL Editor에서 `supabase-schema.sql`을 한 번 실행한 뒤, Vercel 환경변수에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 추가하세요. 공유 메모는 로그인 없이 보기 링크로 열람되고, 수정 권한은 작성 브라우저에 저장되는 수정 토큰으로 처리됩니다.

## 카카오맵

Kakao Developers에서 Web 플랫폼 도메인 `https://myeonjeok-note.vercel.app`을 등록하고, Kakao Map API를 활성화한 뒤 JavaScript 키를 Vercel 환경변수 `KAKAO_MAP_JS_KEY`로 추가하세요. 키가 없으면 앱은 지도 대신 카카오맵 검색 링크만 표시합니다.
