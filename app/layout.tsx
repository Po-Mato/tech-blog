import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { isRTL } from "react-aria-components";
import "./globals.css";

import DynamicUniverse from "../src/components/DynamicUniverse";
import { site } from "../src/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.title,
    template: `%s | ${site.title}`,
  },
  description: site.description,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: site.url,
    title: site.title,
    description: site.description,
    siteName: site.title,
    locale: site.locale,
    images: [{ url: site.ogImage }],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: [site.ogImage],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = site.locale;

  return (
    <html lang={lang} dir={isRTL(lang) ? "rtl" : "ltr"} className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-full`}
      >
        <DynamicUniverse />
        <div className="relative z-10 h-full">
          {children}
        </div>
      </body>
    </html>
  );
}
