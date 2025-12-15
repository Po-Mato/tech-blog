# Deployment Configuration - Root

## GitHub Pages Deployment

The project uses GitHub Actions for deployment to GitHub Pages.

**Workflow:** `deploy.yaml`

**Key Steps:**
- Checkout repository
- Set up Node.js (v18)
- Install dependencies (`npm install`)
- Build project (`npm run build`)
- Deploy to GitHub Pages using `peaceiris/actions-gh-pages@v3`
  - `publish_dir`: `./dist`
  - `destination_dir`: `../Po-Mato.github.io`
