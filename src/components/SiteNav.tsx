"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

const items: NavItem[] = [
  { href: "/", label: "블로그" },
  { href: "/games/", label: "게임" },
  { href: "/portfolio/", label: "포트폴리오" },
  { href: "/search/", label: "검색" },
  { href: "/tags/", label: "태그" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/35 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3 md:px-8">
        <Link
          href="/"
          className="text-sm font-semibold tracking-[0.18em] text-white/85 transition hover:text-white"
        >
          PO-MATO DEVLOG
        </Link>

        <nav className="flex flex-wrap items-center gap-2 text-sm">
          {items.map((it) => {
            const active = isActive(pathname, it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`rounded-full border px-3 py-1.5 transition ${
                  active
                    ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100 shadow-[0_0_0_1px_rgba(56,189,248,0.2)]"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
