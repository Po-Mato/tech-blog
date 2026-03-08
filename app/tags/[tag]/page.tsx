import Link from "next/link";
import { notFound } from "next/navigation";

import { getAllPosts } from "../../../src/lib/posts";
import { getAllTags, slugToTag, tagToSlug } from "../../../src/lib/tags";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const tags = await getAllTags();
  return tags.map(({ tag }) => ({ tag: tagToSlug(tag) }));
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: tagSlug } = await params;
  const tag = slugToTag(tagSlug);
  const posts = (await getAllPosts()).filter((p) => (p.tags ?? []).includes(tag));

  if (!tag) notFound();

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-12 text-white md:px-8">
      <header className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur">
        <div className="text-xs tracking-[0.2em] text-white/55">
          <Link className="transition hover:text-cyan-100" href="/tags/">
            TAGS
          </Link>
        </div>
        <h1 className="mt-2 text-4xl font-semibold">#{tag}</h1>
        <p className="mt-3 text-white/75">{posts.length}개의 글</p>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">해당 태그의 글이 없습니다.</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {posts.map((post) => (
            <li
              key={post.slug}
              className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur transition hover:border-white/20 hover:bg-black/40"
            >
              <div className="text-sm text-white/60">{post.date}</div>
              <h2 className="mt-1 text-xl font-semibold">
                <Link
                  className="transition hover:text-cyan-100"
                  href={`/posts/${post.slug}/`}
                >
                  {post.title}
                </Link>
              </h2>
              {post.description ? (
                <p className="mt-2 text-sm text-white/78">{post.description}</p>
              ) : null}
              {post.tags?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {post.tags.map((t) => (
                    <Link
                      key={t}
                      href={`/tags/${tagToSlug(t)}/`}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 transition hover:border-cyan-300/35 hover:text-cyan-100"
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
