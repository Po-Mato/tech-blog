# Po-Mato 기술 블로그

AI 에이전트와 소프트웨어 아키텍처를 기록하는 Next.js 정적 블로그입니다.

- 사이트: https://po-mato.github.io
- 소스: https://github.com/Po-Mato/tech-blog
- 글: `content/posts/`
- 추천·시리즈: `src/lib/editorial.ts`

## 개발

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## 검증

```sh
pnpm lint
pnpm test
pnpm build
```

`pnpm build`는 콘텐츠 메타데이터, 검색·RSS, 페이지 이동, 태그와 시리즈의 정적 산출물까지 검사합니다. 결과물은 `out/`에 생성됩니다.

`main`에 push하면 GitHub Actions가 `Po-Mato/Po-Mato.github.io`에 배포합니다. [발행·배포 가이드](docs/blog-publishing.md)를 참고하세요.
