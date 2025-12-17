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
};

export default nextConfig;
