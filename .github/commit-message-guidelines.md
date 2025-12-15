# Commit Message Guidelines (Conventional Commits)

이 저장소의 커밋 메시지는 **Conventional Commits** 규칙을 따릅니다.

## TL;DR

- 형식: `<type>(<scope>): <subject>`
- 예: `feat(universe): 마우스 패럴랙스 드리프트 추가`
- **subject/body는 한국어 우선**(간결한 서술/명령형)으로 작성
  - type/scope는 Conventional Commits 관례대로 영문 키워드 사용(`feat`, `fix` 등)
- 필요한 경우 body/footers에 이유, 영향, 마이그레이션, 이슈 링크를 기록

---

## 1) 기본 포맷

```
<type>(<scope>): <subject>

<body>

<footer>
```

- `type`: 변경의 성격(아래 목록 참고)
- `scope`: 변경 범위(선택) — 폴더/기능 단위 추천
- `subject`: 무엇을 했는지 한 줄 요약
- `body`: 왜/어떻게(선택) — 맥락, 트레이드오프, 대안
- `footer`: 이슈/PR/Breaking change/참조(선택)

## 2) type 목록

- `feat`: 사용자 가치가 있는 기능 추가
- `fix`: 버그 수정
- `docs`: 문서 변경(README, docs, 주석 등)
- `style`: 코드 동작 변화 없는 포맷/스타일(공백, 세미콜론 등)
- `refactor`: 동작 동일, 구조 개선
- `perf`: 성능 개선
- `test`: 테스트 추가/수정
- `build`: 빌드 시스템/툴링 변경(Next config, TS config, 패키징)
- `ci`: CI/CD 변경(GitHub Actions 등)
- `chore`: 기타 잡일(정리, 메타데이터 등)
- `revert`: 되돌리기

## 3) scope 추천(예시)

이 저장소 구조(Next.js app router + `src/components`) 기준으로 아래처럼 쓰는 것을 권장합니다.

- `app`: `app/` 전반(라우팅, 레이아웃, 페이지)
- `posts`: `app/posts/` 관련
- `components`: `src/components/` 전반
- `universe`: `Universe.tsx` / `DynamicUniverse.tsx` / `Universe.scss`
- `styles`: CSS/Tailwind 설정/전역 스타일
- `deps`: 의존성 변경(`package.json`, `pnpm-lock.yaml`)
- `config`: 설정 파일(`next.config.ts`, `tsconfig*.json`, eslint 등)
- `ci`: 워크플로(`deploy.yaml` 등)

scope가 애매하면 생략 가능하지만, **작업 범위가 명확할수록** 리뷰/검색이 쉬워집니다.

## 4) subject 작성 규칙

- **한국어 우선**을 권장합니다.
  - 좋은 예: `추가`, `수정`, `제거`, `방지`, `개선`, `정리`
- 마침표(`.`)는 보통 붙이지 않습니다.
- 과도한 정보(세부 구현)는 subject가 아니라 body로 이동합니다.

### ✅ Good
- `fix(posts): slug 파라미터 누락 시 404 처리`
- `refactor(components): 캔버스 정리 로직 헬퍼로 분리`

### ❌ Bad
- `버그 고침`
- `업데이트`
- `feat: 기능도 추가하고 리팩터링도 하고 버그도 고침`

## 5) body(선택) 작성 가이드

body에는 “무엇”보다 **왜/어떻게/영향**을 기록합니다.

- 변경 이유/배경
- 사용자 영향/리스크
- 대안 비교(있다면)
- 재현 방법/검증 방법

권장 스타일:

- 한 줄 72~100자 내로 줄바꿈
- 불릿 포인트 사용 OK

## 6) Breaking Change

호환성 깨짐이 있다면 다음 중 하나로 표현합니다.

1) `!` 사용:
- `feat(app)!: migrate routing to new layout`

2) footer 사용:

- `BREAKING CHANGE: 기존 URL 스키마가 변경되어 리다이렉트가 필요합니다.`

## 7) 이슈/PR 연결

footer에 아래처럼 연결합니다.

- `Refs: #123`
- `Fixes: #123`

## 8) 예시 모음

- 기능 추가
  - `feat(universe): 포그 레이어 텍스처 추가`

- 버그 수정
  - `fix(components): 언마운트 시 three.js renderer 해제`

- 리팩터링
  - `refactor(app): 포스트 로더 유틸 분리`

- 의존성/설정
  - `chore(deps): next 16.0.10로 업데이트`
  - `build(config): app router용 tsconfig 강화`

- 배포/CI
  - `ci(deploy): 캐시 사용하여 dist 퍼블리시`

---

## 9) 커밋 단위(권장)

- 하나의 커밋은 하나의 의도를 갖도록 쪼갭니다.
  - 예: `refactor`와 `feat`를 한 커밋에 섞지 않기
- 자동 생성 파일/락파일은 필요한 경우에만 포함
  - 단, `package.json` 변경 시 `pnpm-lock.yaml`은 함께 반영하는 것을 권장
