import Link from "next/link";

import { getAllPosts } from "../src/lib/posts";
import { getAllTags, tagToSlug } from "../src/lib/tags";

export default async function Home() {
  const posts = await getAllPosts();
  const tags = await getAllTags();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <header className="mb-10">
        <h1 className="text-4xl font-bold">기술 블로그</h1>
        <p className="mt-3 text-lg text-white/80">
          개발하면서 배운 것과 삽질 로그를 기록합니다.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href="/search/"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80 hover:bg-white/10"
          >
            검색
          </Link>

          {tags.length ? (
            <Link
              href="/tags/"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80 hover:bg-white/10"
            >
              태그 전체 보기
            </Link>
          ) : null}
          {tags.slice(0, 10).map(({ tag, count }) => (
            <Link
              key={tag}
              href={`/tags/${tagToSlug(tag)}`}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80 hover:bg-white/10"
              title={`${count} posts`}
            >
              #{tag}
            </Link>
          ))}
        </div>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">아직 글이 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {posts.map((post) => (
            <li
              key={post.slug}
              className="rounded-xl border border-white/10 bg-black/30 p-6 backdrop-blur"
            >
              <div className="text-sm text-white/60">{post.date}</div>
              <h2 className="mt-1 text-2xl font-semibold">
                <Link className="hover:underline" href={`/posts/${post.slug}`}> 
                  {post.title}
                </Link>
              </h2>
              {post.description ? (
                <p className="mt-2 text-white/80">{post.description}</p>
              ) : null}
              {post.tags?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {post.tags.map((t) => (
                    <Link
                      key={t}
                      href={`/tags/${tagToSlug(t)}`}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                    >
                      #{t}
                    </Link>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}