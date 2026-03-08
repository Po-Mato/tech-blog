import { Suspense } from "react";

import SearchClient from "./SearchClient";

export const dynamic = "force-static";

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
