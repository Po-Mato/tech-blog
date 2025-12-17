# Sprint 1 Plan — tech-blog

**기간:** (권장) 1주
**목표:** 블로그 MVP(홈 목록 + 포스트 상세) + 배포 파이프라인 정합성 확보

---

## 체크리스트(실행 순서 추천)

### 0) 결정(당일)
- [ ] 콘텐츠 소스: Markdown/MDX 중 선택 + 디렉터리 확정
- [ ] 배포 타깃: GitHub Pages(정적 export) 유지 vs 호스팅 전환

### 1) 배포 정리 (P0)
- [ ] `deploy.yaml`의 산출물 디렉터리 정합성 수정
- [ ] GitHub Pages 유지 시 base path/asset path 이슈 점검
- [ ] 배포 후 URL에서 `/` 접근 확인

### 2) 콘텐츠 파이프라인 (P0)
- [ ] `content/posts/`에 샘플 2개 작성
- [ ] frontmatter: title/date/slug/description/tags 합의
- [ ] 목록/상세 데이터 로더 구현

### 3) 화면 구현 (P0)
- [ ] 홈(`/`) 목록 렌더링 + 빈 상태
- [ ] 상세(`/posts/[slug]`) 렌더링 + 404 처리

### 4) 마감 작업
- [ ] `metadata` 업데이트
- [ ] 가독성 개선(오버레이/컨테이너)
- [ ] 문서 업데이트(개발/배포 가이드 정합)
- [ ] `pnpm build`, `pnpm lint` 통과 확인

---

## 데모 스크립트

1) 홈에서 포스트 2개가 보임
2) 하나 클릭 → 상세에서 본문 렌더링
3) 존재하지 않는 slug 접근 → 404
4) 배포 URL에서도 동일하게 재현
