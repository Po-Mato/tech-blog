import { Suspense } from "react";
import type { Metadata } from "next";

import SearchClient from "./SearchClient";
import { site } from "../../src/lib/site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "검색",
  description: "Mato Po Tech Blog의 글과 포트폴리오를 통합 검색합니다.",
  alternates: {
    canonical: "/search/",
  },
  openGraph: {
    type: "website",
    url: `${site.url}/search/`,
    title: `검색 | ${site.title}`,
    description: "Mato Po Tech Blog의 글과 포트폴리오를 통합 검색합니다.",
    images: [{ url: site.ogImage }],
  },
};

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-white md:px-8">
          <header className="mb-8">
            <h1 className="text-4xl font-semibold">검색</h1>
            <p className="mt-3 text-white/75">로딩 중...</p>
          </header>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
            <p className="text-white/80">검색 페이지 준비 중...</p>
          </div>
        </main>
      }
    >
      <SearchClient />
    </Suspense>
  );
}
