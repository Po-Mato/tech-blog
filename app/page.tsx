import Link from "next/link";

import { getAllPosts } from "../src/lib/posts";
import { getAllTags, tagToSlug } from "../src/lib/tags";

export default async function Home() {
  const posts = await getAllPosts();
  const tags = await getAllTags();
  const latestPost = posts[0];
  const restPosts = posts.slice(1);

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-12 text-white md:px-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/30 backdrop-blur-xl md:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.20),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(167,139,250,0.16),transparent_38%)]" />

        <div className="relative">
          <p className="text-xs font-medium tracking-[0.25em] text-cyan-200/80">
            TECH BLOG
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
            실험, 설계, 시행착오를
            <br className="hidden md:block" />
            기록하는 개발 아카이브
          </h1>
          <p className="mt-4 max-w-2xl text-base text-white/75 md:text-lg">
            단순한 튜토리얼 복붙이 아닌, 실제 문제를 부딪히며 해결한 과정과
            인사이트를 정리합니다.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Link
              href="/search/"
              className="rounded-full border border-cyan-200/40 bg-cyan-300/15 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/25"
            >
              통합 검색
            </Link>

            {tags.length ? (
              <Link
                href="/tags/"
                className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/85 transition hover:bg-white/15"
              >
                태그 전체 보기
              </Link>
            ) : null}
          </div>

          {tags.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.slice(0, 8).map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/tags/${tagToSlug(tag)}/`}
                  className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70 transition hover:border-cyan-200/35 hover:text-cyan-100"
                  title={`${count} posts`}
                >
                  #{tag}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {posts.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">아직 글이 없습니다.</p>
        </div>
      ) : (
        <>
          {latestPost ? (
            <section className="mt-10">
              <h2 className="mb-4 text-sm font-semibold tracking-[0.18em] text-white/55">
                LATEST
              </h2>
              <article className="group rounded-2xl border border-white/12 bg-white/[0.03] p-7 backdrop-blur transition hover:border-cyan-200/35 hover:bg-white/[0.05]">
                <div className="text-sm text-white/55">{latestPost.date}</div>
                <h3 className="mt-2 text-2xl font-semibold md:text-3xl">
                  <Link
                    className="transition group-hover:text-cyan-100"
                    href={`/posts/${latestPost.slug}/`}
                  >
                    {latestPost.title}
                  </Link>
                </h3>
                {latestPost.description ? (
                  <p className="mt-3 text-white/75">{latestPost.description}</p>
                ) : null}
              </article>
            </section>
          ) : null}

          {restPosts.length ? (
            <section className="mt-10">
              <h2 className="mb-4 text-sm font-semibold tracking-[0.18em] text-white/55">
                ALL POSTS
              </h2>
              <ul className="grid gap-4 md:grid-cols-2">
                {restPosts.map((post) => (
                  <li
                    key={post.slug}
                    className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur transition hover:border-white/20 hover:bg-black/40"
                  >
                    <div className="text-sm text-white/55">{post.date}</div>
                    <h3 className="mt-2 text-xl font-semibold leading-snug">
                      <Link
                        className="transition hover:text-cyan-100"
                        href={`/posts/${post.slug}/`}
                      >
                        {post.title}
                      </Link>
                    </h3>
                    {post.description ? (
                      <p className="mt-2 text-sm text-white/75">{post.description}</p>
                    ) : null}
                    {post.tags?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {post.tags.map((t) => (
                          <Link
                            key={t}
                            href={`/tags/${tagToSlug(t)}/`}
                            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition hover:border-cyan-300/35 hover:text-cyan-100"
                          >
                            #{t}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
