# Implementation Readiness — tech-blog

**작성일:** 2025-12-17

이 문서는 `docs/epics-and-stories.md`에 정의된 P0 범위를 **실제로 구현/배포 가능한 상태**로 만들기 위한 준비도(ready-to-implement) 체크리스트입니다.

---

## 1) 현재 상태 요약(팩트)

- 프레임워크: Next.js(App Router) + React + TypeScript
- 페이지:
  - `app/page.tsx`(홈) — placeholder
  - `app/posts/[slug]/page.tsx`(포스트 상세) — placeholder
- 배경 비주얼:
  - `src/components/Universe.tsx` / `DynamicUniverse.tsx` (Client Component)
- 품질 게이트:
  - `pnpm lint`(eslint) 존재
  - 테스트 코드는 아직 없음

---

## 2) 구현 전 반드시 결정해야 할 사항(결정 포인트)

### D1. 콘텐츠 소스(포스트 저장 방식)
- 후보
  1) 로컬 Markdown/MDX 파일(`content/posts/*.md(x)`) + frontmatter
  2) 외부 CMS/DB (추후)
- 권장(MVP): **로컬 Markdown + frontmatter**
- 산출물
  - 디렉터리/파일 규칙 문서화
  - 최소 메타데이터: `title`, `date`, `slug` (+ 선택: `description`, `tags`)

### D2. 배포 타깃(중요)
현재 `deploy.yaml`은 GitHub Pages로 배포하되 **`publish_dir: ./dist`**를 사용하고 있습니다.
하지만 Next.js의 기본 빌드 출력은 `dist`가 아닙니다(`.next`, 또는 정적 export 시 `out`).

- 선택지
  1) **GitHub Pages 유지**: Next 정적 export로 전환하고 `publish_dir`를 `out`로 수정
  2) **Vercel/다른 호스팅**: Next 기본 배포 플로우로 변경

> Sprint 1에서 P0로 처리 권장: “배포 파이프라인이 실제 출력 디렉터리와 일치”하도록 정리

### D3. 라우팅/정적 생성 전략
- 목표: `/posts/[slug]`가 slug에 따라 정상 렌더링 + slug 없을 때 404
- GitHub Pages(정적) 선택 시: 동적 라우트/MDX 렌더링이 **정적 export 제약**을 받으므로 설계가 필요

---

## 3) 개발 환경/로컬 실행 준비

### 필수
- Node.js 18+
- pnpm 권장

### 스크립트 정합성 점검(필수)
- `package.json` 기준 스크립트
  - `dev`: `next dev`
  - `build`: `next build`
  - `start`: `next start`
  - `lint`: `eslint`

> 참고: 기존 생성 문서 중 `preview` 스크립트 언급이 있는데, 현재 `package.json`에는 없습니다.
> 문서/스크립트 중 하나를 Sprint 1에서 정리해야 합니다.

---

## 4) 품질 게이트(최소 기준)

### P0: 구현 준비 완료 조건
- [ ] `pnpm install` 성공
- [ ] `pnpm dev`로 홈/상세 페이지 접근 가능
- [ ] `pnpm build` 성공
- [ ] `pnpm lint` 성공

### P1: 추가 권장
- [ ] 최소 스모크 테스트(렌더링/라우팅) 도입
- [ ] dead link/404 케이스 확인

---

## 5) 성능/안정성 체크(유니버스 배경)

- [ ] 배경은 Client Component로만 실행(SSR 접근 금지) — 현재 반영됨
- [ ] 언마운트 시 리소스 해제(렌더러 dispose, 이벤트 제거)
- [ ] 콘텐츠 가독성(오버레이/대비) 확보
- [ ] 저사양 환경에서 프레임/팬 소음 이슈 발생 시 “배경 끄기” 옵션 고려

---

## 6) 리스크 & 완화

- **R1: 배포 설정 불일치**
  - 증상: Actions는 성공/실패 여부와 무관하게 결과물이 비어 있거나 404
  - 완화: 정적 export 도입 또는 호스팅 전환

- **R2: 동적 라우트 + 정적 export 제약**
  - 완화: 빌드 시 slug 목록을 확정(generateStaticParams 등)하고 out에 정적 페이지 생성

- **R3: 콘텐츠 렌더링(XSS/unsafe HTML)**
  - 완화: Markdown 렌더러 선택 시 HTML 처리 정책 명확화(기본은 escape)

---

## 7) Sprint 1에서 Readiness를 “완료”로 보기 위한 산출물

- (필수) 배포 방식(D2) 결정 및 워크플로 수정 PR
- (필수) 콘텐츠 소스(D1) 결정 및 최소 2개 샘플 포스트 추가
- (필수) `/` 및 `/posts/[slug]`가 실제 콘텐츠 기반으로 렌더링
- (필수) 문서 정합성 업데이트(개발 가이드/배포 가이드)
