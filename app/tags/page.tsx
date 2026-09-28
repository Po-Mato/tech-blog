import TagSearch from "../../src/components/TagSearch";
import type { Metadata } from "next";

import { getAllTags, tagToSlug } from "../../src/lib/tags";
import { site } from "../../src/lib/site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "태그 아카이브",
  description: "Mato Po Tech Blog의 글을 태그별로 탐색합니다.",
  alternates: {
    canonical: "/tags/",
  },
  openGraph: {
    type: "website",
    url: `${site.url}/tags/`,
    title: `태그 아카이브 | ${site.title}`,
    description: "Mato Po Tech Blog의 글을 태그별로 탐색합니다.",
    images: [{ url: site.ogImage }],
  },
};

export default async function TagsPage() {
  const tags = await getAllTags();

  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-white md:px-8">
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
        <TagSearch tags={tags.map(entry => ({ ...entry, href: `/tags/${tagToSlug(entry.tag)}/` }))} />
      )}
    </main>
  );
}
