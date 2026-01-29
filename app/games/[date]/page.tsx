import type { Metadata } from "next";
import { notFound } from "next/navigation";

import GameClient from "../GameClient";
import { getGameByDate, getGameDates } from "../../../src/lib/games";
import { site } from "../../../src/lib/site";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const dates = await getGameDates();
  return dates.map((date) => ({ date }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<Metadata> {
  const { date } = await params;
  const game = await getGameByDate(date);
  if (!game) return {};

  const title = `${game.title} (${date})`;
  const description = game.description ?? site.description;
  const url = `${site.url}/games/${date}/`;

  return {
    title,
    description,
    alternates: { canonical: `/games/${date}/` },
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

export default async function GamePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const game = await getGameByDate(date);
  if (!game) notFound();

  return (
    <main className="mx-auto max-w-3xl p-10 text-white">
      <header className="mb-8">
        <div className="text-sm text-white/60">{date}</div>
        <h1 className="mt-2 text-4xl font-bold">{game.title}</h1>
        {game.description ? (
          <p className="mt-3 text-white/80">{game.description}</p>
        ) : null}
      </header>

      <div className="rounded-xl border border-white/10 bg-black/30 p-6 backdrop-blur">
        <GameClient game={game} />
      </div>
    </main>
  );
}
