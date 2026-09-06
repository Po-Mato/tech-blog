import Link from 'next/link';
import { getAllPosts } from '../src/lib/posts';
import { getAllTags, tagToSlug } from '../src/lib/tags';
import { featuredSlugs, pageCount, postsOnPage, selectPosts, series } from '../src/lib/editorial';
import { formatDate } from '../src/lib/content/metadata.mjs';
import PostList from '../src/components/PostList';
import Pagination from '../src/components/Pagination';

export default async function Home() {
  const [posts, tags] = await Promise.all([getAllPosts(), getAllTags()]);
  const featured = selectPosts(posts, featuredSlugs);
  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-10 text-white md:px-8 md:pt-16">
      <header className="grid gap-8 border-b border-white/15 pb-10 md:grid-cols-[1fr_16rem] md:items-end md:pb-14">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-cyan-200">
            PO-MATO / ENGINEERING NOTES
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            직접 고민한 설계,
            <br />
            <span className="text-white/55">함께 나누는 기록.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/70">
            AI 에이전트와 소프트웨어 아키텍처를 탐구합니다.
            <br className="hidden sm:block" /> 구조를 이해하고, 선택의 이유를 기록합니다.
          </p>
        </div>
        <div className="space-y-4 border-l border-cyan-200/40 pl-5 text-sm">
          <p className="text-white/55">
            기록한 글 <span className="ml-2 font-mono text-white">{posts.length}</span>
          </p>
          {posts[0] ? (
            <p className="text-white/55">
              최근 발행{' '}
              <time className="ml-2 font-mono text-white" dateTime={posts[0].date}>
                {formatDate(posts[0].date)}
              </time>
            </p>
          ) : null}
          <Link className="block text-cyan-200 hover:underline" href="/search/">
            글 검색하기 ↗
          </Link>
          <a className="block text-white/70 hover:text-cyan-200" href="/rss.xml">
            RSS로 새 글 받기 ↗
          </a>
        </div>
      </header>

      {featured.length ? (
        <section aria-labelledby="featured-heading" className="mt-12">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
            <h2 id="featured-heading" className="text-xl font-semibold">
              처음이라면 이 글부터
            </h2>
            <p className="text-sm text-white/50">주제별로 골라 읽는 추천 글</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {featured.map((post, index) => (
              <article
                key={post.slug}
                className="flex flex-col border border-white/15 bg-slate-950/80 p-6"
              >
                <span className="font-mono text-sm text-cyan-200/70">0{index + 1} / SELECTED</span>
                <h3 className="mt-6 text-xl font-semibold leading-snug">
                  <Link className="hover:text-cyan-200" href={`/posts/${post.slug}/`}>
                    {post.title}
                  </Link>
                </h3>
                <p className="mb-5 mt-3 text-sm leading-relaxed text-white/65">
                  {post.description}
                </p>
                <time className="mt-auto font-mono text-xs text-white/45" dateTime={post.date}>
                  {formatDate(post.date)}
                </time>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="series-heading" className="mt-12">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="series-heading" className="text-xl font-semibold">
            이어서 읽는 시리즈
          </h2>
          <Link href="/series/" className="text-sm text-cyan-200 hover:underline">
            전체 보기 ↗
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {series.map((item) => (
            <Link
              key={item.slug}
              href={`/series/${item.slug}/`}
              className="group border-l-2 border-cyan-200/35 bg-white/[0.03] px-5 py-4 hover:border-cyan-200 hover:bg-white/[0.06]"
            >
              <span className="text-xs text-white/50">{item.slugs.length}편의 읽기 순서</span>
              <h3 className="mt-2 text-base font-medium group-hover:text-cyan-200">
                {item.title} <span aria-hidden="true">↗</span>
              </h3>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="latest-heading" className="mt-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3 border-b border-white/15 pb-5">
          <div>
            <p className="mb-2 font-mono text-xs tracking-widest text-cyan-200/70">LATEST NOTES</p>
            <h2 id="latest-heading" className="text-2xl font-semibold">
              최신 글
            </h2>
          </div>
          <span className="text-sm text-white/50">전체 {posts.length}편 · 최신 10편</span>
        </div>
        {posts.length ? (
          <PostList posts={postsOnPage(posts, 1)} />
        ) : (
          <p className="text-white/70">아직 글이 없습니다.</p>
        )}
        <Pagination current={1} total={pageCount(posts.length)} />
      </section>

      <section aria-labelledby="topics-heading" className="mt-14 border-t border-white/10 pt-8">
        <div className="flex items-center justify-between">
          <h2 id="topics-heading" className="text-lg font-semibold">
            관심 있는 주제로
          </h2>
          <Link href="/tags/" className="text-sm text-cyan-200 hover:underline">
            모든 태그 ↗
          </Link>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {tags.slice(0, 8).map(({ tag, count }) => (
            <Link
              key={tag}
              href={`/tags/${tagToSlug(tag)}/`}
              className="border border-white/15 px-3 py-2 text-sm text-white/70 hover:border-cyan-200/50 hover:text-cyan-200"
            >
              #{tag} <span className="ml-2 text-white/40">{count}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
