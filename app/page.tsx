import Link from "next/link";

import { getAllPosts } from "../src/lib/posts";
import { getAllTags, tagToSlug } from "../src/lib/tags";

export default async function Home() {
  const posts = await getAllPosts();
  const tags = await getAllTags();
  const latestPost = posts[0];
  const restPosts = posts.slice(1);

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-8 text-white md:px-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/30 backdrop-blur-xl md:p-10 transition duration-500 hover:border-cyan-300/30 hover:shadow-cyan-900/30">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.15),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(167,139,250,0.10),transparent_38%)]" />

        <div className="relative">
          <p className="text-xs font-medium tracking-[0.25em] text-cyan-200/80">
            DEVLOG
          </p>
          <h1 className="mt-2 text-4xl font-bold leading-tight md:text-6xl">
            실험과 설계의
            <br />
            고급화 기록
          </h1>
          <p className="mt-4 max-w-2xl text-base text-white/75 md:text-lg">
            복잡한 기술 스택을 깊이 파고든 과정, 아키텍처 의사결정 및 시행착오를
            투명하게 공유합니다.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/search/"
              className="rounded-full border border-cyan-300/50 bg-cyan-300/20 px-5 py-2.5 text-sm font-medium text-cyan-50 shadow-lg shadow-cyan-500/20 transition duration-300 hover:bg-cyan-300/30 hover:shadow-cyan-500/35"
            >
              통합 검색
            </Link>

            {tags.length ? (
              <Link
                href="/tags/"
                className="rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm text-white/85 transition duration-300 hover:border-white/20 hover:bg-white/15"
              >
                태그 전체 보기
              </Link>
            ) : null}
          </div>

          {tags.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {tags.slice(0, 8).map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/tags/${tagToSlug(tag)}/`}
                  className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70 transition duration-200 hover:border-cyan-200/35 hover:text-cyan-100"
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
            <section className="mt-12">
              <h2 className="mb-4 text-sm font-semibold tracking-[0.18em] text-white/55">
                LATEST ENTRY
              </h2>
              <article className="group rounded-2xl border border-white/15 bg-black/30 p-7 shadow-xl backdrop-blur transition duration-300 hover:border-cyan-300/40 hover:bg-black/40">
                <div className="text-sm text-white/55">{latestPost.date}</div>
                <h3 className="mt-2 text-2xl font-bold leading-snug md:text-3xl">
                  <Link
                    className="transition group-hover:text-cyan-200"
                    href={`/posts/${latestPost.slug}/`}
                  >
                    {latestPost.title}
                  </Link>
                </h3>
                {latestPost.description ? (
                  <p className="mt-3 text-base text-white/80">{latestPost.description}</p>
                ) : null}
              </article>
            </section>
          ) : null}

          {restPosts.length ? (
            <section className="mt-12">
              <h2 className="mb-5 text-sm font-semibold tracking-[0.18em] text-white/55">
                ARCHIVES ({restPosts.length} POSTS)
              </h2>
              <ul className="grid gap-4 md:grid-cols-2">
                {restPosts.map((post) => (
                  <li
                    key={post.slug}
                    className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur transition duration-200 hover:border-white/20 hover:bg-black/40"
                  >
                    <div className="text-sm text-white/55">{post.date}</div>
                    <h3 className="mt-1 text-xl font-semibold leading-snug">
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
                            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition duration-200 hover:border-cyan-300/35 hover:text-cyan-100"
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
