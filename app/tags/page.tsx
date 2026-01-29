import Link from "next/link";

import { getAllTags, tagToSlug } from "../../src/lib/tags";

export const dynamic = "force-static";

export default async function TagsPage() {
  const tags = await getAllTags();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <header className="mb-10">
        <h1 className="text-4xl font-bold">태그</h1>
        <p className="mt-3 text-lg text-white/80">글에 달린 태그를 모아봤어요.</p>
      </header>

      {tags.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6">
          <p className="text-white/80">태그가 아직 없습니다.</p>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map(({ tag, count }) => (
            <li key={tag}>
              <Link
                href={`/tags/${tagToSlug(tag)}/`}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80 hover:bg-white/10"
              >
                <span>#{tag}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">
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
