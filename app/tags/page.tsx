import Link from "next/link";
import { notFound } from "next/navigation";

import { getAllPosts } from "../../../src/lib/posts";
import { getAllTags, tagToSlug } from "../../../src/lib/tags";

export const dynamic = "force-static";

export default async function TagsPage() {
  const tags = await getAllTags();

  return (
    <main className="mx-auto max-w-5xl px-6 pb-16 pt-8 text-white md:px-8">
      <header className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur transition duration-300 hover:border-cyan-300/30">
        <p className="text-xs font-medium tracking-[0.22em] text-cyan-200/80">TAGS</p>
        <h1 className="mt-2 text-4xl font-bold">태그 아카이브</h1>
        <p className="mt-3 text-white/75">글에 달린 태그를 한눈에 탐색해보세요.</p>
      </header>

      {tags.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">태그가 아직 없습니다.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map(({ tag, count }) => (
            <li key={tag}>
              <Link
                href={`/tags/${tagToSlug(tag)}/`}
                className="group flex items-center justify-between rounded-2xl border border-white/10 bg-black/25 px-4 py-3 transition duration-200 hover:border-cyan-300/35 hover:bg-black/35"
              >
                <span className="text-white/85 transition group-hover:text-cyan-100">#{tag}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/65">
                  {count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
