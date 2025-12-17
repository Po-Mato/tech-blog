import Link from "next/link";

import { getAllPosts } from "../src/lib/posts";

export default async function Home() {
  const posts = await getAllPosts();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <header className="mb-10">
        <h1 className="text-4xl font-bold">기술 블로그</h1>
        <p className="mt-3 text-lg text-white/80">
          개발하면서 배운 것과 삽질 로그를 기록합니다.
        </p>
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
                    <span
                      key={t}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70"
                    >
                      #{t}
                    </span>
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