# 블로그 개선 기록

## 2026-09-07 22시 정기 실행

- 시작 소스: `7a23ebf2907d85e4f05c88493152b2966098107f`. 원본 checkout은 깨끗하며 `pnpm automation:guard` 통과.
- 전용 worktree에서 SEARCH-001 수정: 원문 일치 구간을 한 번만 처리하고 각 구간을 HTML escape한 뒤 강조 태그 생성.
- 회귀 검증 대상: 다중 검색어, HTML 엔티티, 정규식 특수문자, 대소문자, HTML 입력, 빈 검색어.
- 일상 점검 범위: 배포 SHA, 홈·검색·RSS·사이트맵·주요 내부 링크, 모바일 검색 화면. 당일 이미 완료한 날짜·태그 개편은 다시 작업하지 않음.
- 검증 결과: lint 성공, 테스트 43개 통과, build 및 전체 export 검사 성공. 데스크톱·390px 모바일에서 검색 제목 원문 보존과 가로 넘침 없음 확인. 공개 주요 경로 44개 HTTP 200, RSS·사이트맵 XML 정상.
- 커밋·검증 결과: 이 기록을 포함한 커밋의 Actions 및 해당 실행 보고에서 확인. 배포 전 작성한 기록이므로 공개 반영 완료를 주장하지 않음.
- 소스 이력: https://github.com/Po-Mato/tech-blog/commits/main/
- 배포 실행: https://github.com/Po-Mato/tech-blog/actions/workflows/deploy-to-po-mato-pages.yml
- 미해결: 일요일의 기존 글 출처·코드 검토, 월간 유입 데이터 연결 확인.

### 공개 반영 확인

- 개선 소스: `0dc688a5dd488dc1f98f0b1a05323e469f0711e2`.
- [소스 Actions 성공](https://github.com/Po-Mato/tech-blog/actions/runs/34125427616).
- [GitHub Pages 배포 성공](https://github.com/Po-Mato/Po-Mato.github.io/actions/runs/34125538497).
- 배포 저장소 커밋 `869da220782dfe21a5263ca90be6a8ac6d54ca8f`가 개선 소스를 참조하고, 공개 `/build-info.json`의 sourceCommit도 일치.
- [공개 검색 재현 URL](https://po-mato.github.io/search/?q=AI%20a): 새 브라우저 세션에서 제목 원문 보존 및 강조 태그 노출 없음 확인. 기존 세션의 이전 화면은 새 세션에서 해소됨.
- SEARCH-001 완료. 이 후속 문서 커밋은 검증 근거와 완료 상태만 기록함.

## 2026-09-08 22시 정기 실행

- 화요일 점검 실행. 새 장애·회귀가 확인되지 않아 기능과 콘텐츠는 변경하지 않고 이 기록만 추가한다.
- 점검 대상 소스: `6a7d95156ed3963bf990ecbeb79a1022492058b0`. `pnpm automation:guard` 통과, 공개 `/build-info.json`의 sourceCommit 일치.
- 홈에서 연결되는 내부 URL 43개 HTTP 200. RSS·사이트맵 XML 파싱 성공.
- 검색 인덱스와 RSS 모두 공개 글 141편. 최신 글은 `2026-09-02-proactive-update`이며 홈 표시·검색 정렬·RSS 첫 글이 일치한다. 새 글이 없다는 이유만으로 발행일을 바꾸지 않는다.
- 어제의 SEARCH-001 회귀 점검: 공개 검색 `AI a`에서 결과 124개, 제목에 강조 태그 노출 없음. 390×844 모바일 화면을 직접 확인했으며 가로 넘침 없음.
- 점검 URL: https://po-mato.github.io/ 및 https://po-mato.github.io/search/?q=AI%20a
- 기존 배포 근거: https://github.com/Po-Mato/tech-blog/actions/runs/34125763977 및 https://github.com/Po-Mato/Po-Mato.github.io/actions/runs/34125861141
- 문서 기록 검증: lint 성공, 테스트 43개 통과, build 및 전체 정적 산출물 검사 성공. 기록 커밋의 배포 결과는 해당 실행 보고에서 확인한다.
- 미해결 목록은 유지: CONTENT-001은 일요일 순차 검토, ANALYTICS-001은 월간 연결 확인. 이번 실행은 유입·조회 수치를 수집하거나 추정하지 않았다.
