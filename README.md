# 면적노트

도로명주소를 기준으로 건축물대장 공공데이터를 조회해 층, 호, 전유면적, 공용면적, 합계 면적을 확인하는 Vercel 앱입니다.

## 환경변수

- `JUSO_KEY`: 도로명주소 API 승인키
- `BLD_KEY`: 건축물대장 API 서비스키

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포

새 GitHub 저장소와 새 Vercel 프로젝트에 연결해서 배포하세요. 기존 `sarangkim/area-checker-v2` 저장소나 기존 Vercel 프로젝트와 연결하지 마세요.
