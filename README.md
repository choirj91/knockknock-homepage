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

## 블로그 — 불편함 노트

`content/blog/*.md` 파일 하나 = 글 하나. 파일명이 URL slug 가 된다
(`polypharmacy-medication-list.md` → `/blog/polypharmacy-medication-list/`).

### 새 글 쓰기

```bash
# 1. content/blog/<slug>.md 생성 후 프론트매터 작성
# 2. 로컬 확인
pnpm dev
# 3. 배포
pnpm pages:deploy
```

프론트매터 형식 (`title`·`summary`·`date`·`category` 필수, 없으면 빌드 실패):

```markdown
---
title: "제목"
summary: "목록과 meta description 에 쓰이는 한 줄 요약"
date: 2026-08-30
category: "건강"
tags: ["태그1", "태그2"]
---

본문 (마크다운)
```

### 글 구성 원칙

AdSense 가 "가치 없는 콘텐츠"로 두 번 반려한 이력이 있다. 뉴스 요약을 양산하면
같은 판정을 받는다. 아래 구조를 지킬 것:

1. **문제의 크기** — 출처가 명확한 수치로. 기관·기준연도까지 표기
2. **왜 생기는가** — 구조적 원인
3. **기존 해법은 어디까지 왔나** — 이미 있는 것을 인정하고, 남은 빈틈을 짚는다
4. **우리라면 어떻게 풀까** — 1차 관점. 이 섹션이 복제 불가능한 부분이다
5. **확인하지 못한 것** — 검증 실패한 수치를 명시. 신뢰의 근거가 된다
6. **출처** — 링크 목록

수치는 반드시 원문을 확인하고 쓴다. 널리 인용되지만 출처가 특정되지 않는
수치는 본문에서 빼고 "확인하지 못한 것"에 적는다.
