# Deployment Configuration - Root

## GitHub Pages Deployment

The project uses GitHub Actions for deployment to GitHub Pages.

**Workflow:** `deploy.yaml`

**Key Steps:**
- Checkout repository
- Set up Node.js (v18)
- Install dependencies (`pnpm install --frozen-lockfile`)
- Build project (`pnpm build`)
- Deploy to GitHub Pages using `peaceiris/actions-gh-pages@v3`
  - `publish_dir`: `./out` (Next.js static export output)

## Notes

- This repository is configured for **static export** via `next.config.ts` (`output: "export"`).
- If you deploy as Project Pages (e.g. `https://<user>.github.io/<repo>/`), set `NEXT_PUBLIC_BASE_PATH` in CI to `/<repo>`.
