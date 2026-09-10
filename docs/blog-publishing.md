# 블로그 발행과 배포

작업 경로는 `/Users/sjlee/.openclaw/workspace/tech-blog`, 소스 저장소는 `Po-Mato/tech-blog`입니다. 배포된 사이트는 https://po-mato.github.io 입니다.

## 글 작성

`content/posts/*.md` 또는 `*.mdx`에 YAML 메타데이터를 작성합니다. 파일명과 기존 `slug`는 공개 URL이므로 교정할 때 유지합니다.

```yaml
---
title: "구체적인 주제와 독자가 배울 내용"
date: "2026-09-07"
description: "본문에서 실제로 다루는 내용을 한두 문장으로 요약합니다."
tags: ["AI Agents", "Software Architecture"]
---
```

- `date`는 실제 발행일입니다. 재배포만으로 날짜를 바꾸지 않습니다.
- 공개 글에는 제목과 유효한 날짜가 필수이며, 최신 10편에는 요약도 필수입니다.
- 날짜 누락, 잘못된 날짜, 중복 slug는 `pnpm content:check`에서 실패합니다.
- 미완성 글은 `draft: true`로 설정합니다. 홈·검색·RSS·상세 경로에서 제외됩니다.
- `AI`는 넓은 주제로 유지합니다. `AI Agent`는 `AI Agents`, `AgenticAI`는 `Agentic AI`로 통합합니다. 별칭은 `src/lib/content/metadata.mjs`에서 관리합니다.
- 교정 시 코드 블록의 주석을 제목으로 오인하지 않도록 확인합니다. 생성 과정의 자가 평가 문구는 본문에 게시하지 않습니다.

## 글 안의 목차와 문단 링크

본문의 `##`와 `###` 제목으로 목차와 `#section-…` 문단 링크를 자동 생성합니다. 소제목이 2개 이상이면 접고 펼칠 수 있는 목차가 표시됩니다. 한글 제목과 중복 제목을 처리하며 코드 블록 속 제목과 자동 생성 각주는 포함하지 않습니다. 문단의 `#` 링크를 눌러 주소를 공유할 수 있습니다. 제목을 바꾸면 해당 문단 주소도 달라질 수 있으므로 이미 공유한 문단의 제목을 수정할 때 확인합니다.

## 홈과 시리즈

홈에는 추천 3편과 최신 10편을 표시합니다. 이후 글은 `/archive/2/`부터 10편 단위로 제공하며, 1페이지는 `/`입니다. 추천 글과 시리즈 읽기 순서는 `src/lib/editorial.ts`에서 관리합니다. 시리즈에 등록된 글의 하단에는 전체 읽기 순서가 표시됩니다.

태그 링크는 URL에서만 인코딩합니다. `generateStaticParams`에는 원래 태그 이름을 전달해야 이중 인코딩과 빈 태그 페이지를 피할 수 있습니다. 기존 별칭 URL도 생성하고 대표 태그의 canonical을 지정합니다. `CI/CD`처럼 슬래시가 들어가는 태그는 GitHub Pages가 `%2F`를 경로 구분자로 해석하므로, `prepare-pages-paths.mjs`가 HTML과 RSC 파일을 디코딩된 경로에도 복사합니다.

## 검증과 배포

1. 작업 전 `git status --short --branch`를 확인하고 `pnpm automation:guard`를 실행합니다.
2. `pnpm install --frozen-lockfile` 후 `pnpm lint`, `pnpm test`, `pnpm build`를 통과시킵니다.
3. 빌드에는 콘텐츠 검사, 검색 인덱스 생성, RSS 생성, 정적 산출물 검사가 포함됩니다. 산출물 검사는 전체 글 날짜, 15개 목록 페이지, 태그와 별칭, 시리즈, 검색·RSS·사이트맵 연결을 확인합니다. 목록 페이지 수는 글 수에 따라 계산됩니다.
4. 생성된 게임 파일은 이번 개선과 무관하면 커밋하지 않습니다.
5. 승인된 변경을 `main`에 push하면 `Build & Deploy to Po-Mato.github.io`가 검증 후 배포합니다.
6. 소스 Actions 성공뿐 아니라 배포 저장소의 커밋 메시지, GitHub Pages 배포 완료, 실제 사이트의 `/build-info.json`에 기록된 `sourceCommit`도 확인합니다.

2026-09-07 점검에서 9월 글이 4월 글 뒤에 보였던 원인은 날짜 누락 글 4개가 정렬에 `NaN`을 유입시킨 것이었습니다. 메타데이터를 복구하고 모든 발행 경로에서 ISO 날짜를 사용하도록 통일했습니다. 정기 Codex 개선 자동화는 점검 당시 `PAUSED`였으며, 재개 여부는 별도의 운영 설정입니다.


검색 레이아웃 변경 시 `agent-browser`를 설치한 환경에서 정적 산출물을 별도 HTTP 서버로 연 뒤 `pnpm test:search-layout http://localhost:8799`를 실행합니다. 320/390/768/1280px의 실제 결과와 공백 없는 긴 문자열을 검사합니다. 배포 후에는 `pnpm test:search-layout https://po-mato.github.io`로 같은 회귀 검사를 수행할 수 있습니다.
