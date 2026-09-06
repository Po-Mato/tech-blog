import type { PostMeta } from './posts';

export const PAGE_SIZE = 10;
export const featuredSlugs = [
  '2026-04-11-proactive-update',
  '2026-04-13-proactive-update',
  '2026-08-30-proactive-update',
];

export const series = [
  {
    slug: 'agent-memory',
    title: '에이전트 메모리 설계',
    description: '기억의 계층을 이해하고, 장기 보존과 검색·삭제 전략으로 이어갑니다.',
    slugs: [
      '2026-04-11-proactive-update',
      '2026-04-14-proactive-update',
      '2026-08-30-proactive-update',
    ],
  },
  {
    slug: 'agent-reliability',
    title: '에이전트 운영과 신뢰성',
    description: '실행 기록부터 SLO, 관측성, 실패 복구까지 순서대로 읽어보세요.',
    slugs: [
      '2026-04-07-proactive-update',
      '2026-04-08-proactive-update',
      '2026-04-10-proactive-update',
      '2026-04-13-proactive-update',
    ],
  },
  {
    slug: 'agent-development',
    title: '에이전트와 개발하기',
    description: '구성 요소와 작업 분해를 살펴보고, 코드 검토와 배포 검증으로 연결합니다.',
    slugs: [
      '2026-08-24-proactive-update',
      '2026-08-31-proactive-update',
      '2026-08-27-proactive-update',
      '2026-09-01-proactive-update',
      '2026-09-02-proactive-update',
    ],
  },
];

export function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
export function pageHref(page: number) {
  return page === 1 ? '/' : `/archive/${page}/`;
}
export function postsOnPage(posts: PostMeta[], page: number) {
  if (!Number.isInteger(page) || page < 1 || page > pageCount(posts.length)) return [];
  return posts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}
export function selectPosts(posts: PostMeta[], slugs: string[]) {
  const bySlug = new Map(posts.map((post) => [post.slug, post]));
  return slugs.map((slug) => bySlug.get(slug)).filter((post): post is PostMeta => Boolean(post));
}
