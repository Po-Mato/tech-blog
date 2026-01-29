import Link from "next/link";
import { notFound } from "next/navigation";

import { getAllPosts } from "../../../src/lib/posts";
import { getAllTags, slugToTag, tagToSlug } from "../../../src/lib/tags";

export const dynamic = "force-static";

export async function generateStaticParams() {
  const tags = await getAllTags();
  return tags.map(({ tag }) => ({ tag: tagToSlug(tag) }));
}

export default async function TagPage({
  params,
}: {
  params: { tag: string };
}) {
  const tag = slugToTag(params.tag);
  const posts = (await getAllPosts()).filter((p) => (p.tags ?? []).includes(tag));

  if (!tag) notFound();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <header className="mb-10">
        <div className="text-sm text-white/60">
          <Link className="hover:underline" href="/tags/">
            태그
          </Link>
        </div>
        <h1 className="mt-2 text-4xl font-bold">#{tag}</h1>
        <p className="mt-3 text-lg text-white/80">{posts.length}개의 글</p>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">해당 태그의 글이 없습니다.</p>
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
                <Link className="hover:underline" href={`/posts/${post.slug}/`}>
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
                      href={`/tags/${tagToSlug(t)}/`}
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
