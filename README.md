# knockknock-homepage

낰낰컴퍼니(Knock Knock Company) 공식 홈페이지 — https://knockknock.company

## 스택

- Next.js 15 (App Router, `output: "export"` 정적 사이트)
- Tailwind CSS 4
- Cloudflare Pages 배포 (wrangler CLI)

## 개발

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm typecheck
pnpm build      # out/ 에 정적 파일 생성
```

## 배포 (Cloudflare Pages)

최초 1회: Cloudflare 대시보드 또는 `wrangler pages project create knockknock-homepage` 로 프로젝트 생성 후, 커스텀 도메인으로 루트 `knockknock.company` 연결.

```bash
pnpm pages:deploy
```

## 제품 추가 방법

`data/products.ts` 의 `products` 배열에 항목 추가만 하면 됨. 커버는 `cover`(Tailwind gradient 클래스) + `emoji` 조합.

## 컬러 시스템

| 토큰 | 값 | 용도 |
|---|---|---|
| `mist` | `#F7F8FC` | 배경 (쿨 화이트) |
| `periwinkle` | `#A9B5DF` | 보조 배경·태그 |
| `violet` | `#7886C7` | 강조·링크 |
| `navy` | `#2D336B` | 텍스트·버튼 |

## AdSense

`public/ads.txt` → 배포 시 `https://knockknock.company/ads.txt` 로 서빙됨.
