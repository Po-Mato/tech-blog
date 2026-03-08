import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Pages 같은 정적 호스팅을 위한 설정
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // 프로젝트 Pages(예: https://<user>.github.io/<repo>/)를 쓸 경우 BASE_PATH를 설정하세요.
  // 유저/조직 Pages(예: https://<user>.github.io/)는 비워두면 됩니다.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || "",

  // Next.js 16.1 performance optimizations
  experimental: {
    // Enable optimized package imports for better tree-shaking
    optimizePackageImports: ["react-aria-components", "three", "phaser"],
  },

  // Turbopack configuration (Next.js 16+ default)
  turbopack: {
    // 여러 lockfile이 있는 환경(로컬/CI)에서도 프로젝트 루트를 명확히 고정
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
