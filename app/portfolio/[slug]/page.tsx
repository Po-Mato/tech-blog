import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPortfolioBySlug, getPortfolioSlugs } from "../../../src/lib/portfolio";
import { site } from "../../../src/lib/site";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await getPortfolioSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const item = await getPortfolioBySlug(slug);
  if (!item) return {};

  const title = item.title;
  const description = item.description || site.description;
  const url = `${site.url}/portfolio/${item.slug}/`;

  return {
    title,
    description,
    alternates: {
      canonical: `/portfolio/${item.slug}/`,
    },
    openGraph: {
      type: "article",
      url,
      title,
      description,
      images: [{ url: site.ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [site.ogImage],
    },
  };
}

export default async function PortfolioItemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = await getPortfolioBySlug(slug);
  if (!item) notFound();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <article className="rounded-xl border border-white/10 bg-black/30 p-8 backdrop-blur">
        {item.date ? <div className="text-sm text-white/60">{item.date}</div> : null}
        <h1 className="mt-2 text-4xl font-bold">{item.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-white/70">
          {item.featured ? (
            <span className="rounded-full border border-yellow-300/30 bg-yellow-300/10 px-2 py-0.5 text-xs text-yellow-200">
              Featured
            </span>
          ) : null}
          {item.role ? <span>Role: {item.role}</span> : null}
        </div>
        {item.description ? <p className="mt-3 text-white/80">{item.description}</p> : null}

        {item.stack?.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {item.stack.map((s) => (
              <span
                key={s}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70"
              >
                {s}
              </span>
            ))}
          </div>
        ) : null}

        {item.links && (item.links.github || item.links.demo || item.links.doc) ? (
          <div className="mt-6 flex flex-wrap gap-2 text-sm">
            {item.links.github ? (
              <a
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
                href={item.links.github}
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            ) : null}
            {item.links.demo ? (
              <a
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
                href={item.links.demo}
                target="_blank"
                rel="noreferrer"
              >
                Demo
              </a>
            ) : null}
            {item.links.doc ? (
              <a
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
                href={item.links.doc}
                target="_blank"
                rel="noreferrer"
              >
                Doc
              </a>
            ) : null}
          </div>
        ) : null}

        <div
          className="prose prose-invert mt-8 max-w-none"
          dangerouslySetInnerHTML={{ __html: item.contentHtml }}
        />
      </article>
    </main>
  );
}
