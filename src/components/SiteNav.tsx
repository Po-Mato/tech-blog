import Link from "next/link";

type NavItem = { href: string; label: string };

const items: NavItem[] = [
  { href: "/", label: "블로그" },
  { href: "/games/", label: "게임" },
  { href: "/portfolio/", label: "포트폴리오" },
  { href: "/search/", label: "검색" },
  { href: "/tags/", label: "태그" },
];

export default function SiteNav() {
  return (
    <div className="sticky top-0 z-20 border-b border-white/10 bg-black/30 backdrop-blur">
      <nav className="mx-auto flex max-w-3xl items-center gap-3 px-10 py-3 text-sm text-white/80">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 hover:bg-white/10"
          >
            {it.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
