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
  if (href.startsWith("/tags/")) return pathname.startsWith("/tags/");
  return pathname.startsWith(href);
}

export default function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/45 backdrop-blur-2xl transition duration-300">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-8">
        <Link
          href="/"
          className="w-fit text-sm font-semibold tracking-[0.16em] text-white/90 transition duration-300 hover:text-cyan-100"
        >
          PO-MATO DEVLOG
        </Link>

        <nav
          aria-label="메인 네비게이션"
          className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((it) => {
            const active = isActive(pathname, it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition duration-200 ${
                  active
                    ? "border-cyan-300/50 bg-cyan-300/20 text-cyan-50 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]"
                    : "border-white/10 bg-white/[0.06] text-white/75 hover:border-white/20 hover:bg-white/12 hover:text-white"
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
