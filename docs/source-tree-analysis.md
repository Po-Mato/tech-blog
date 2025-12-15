# Source Tree Analysis

This document provides an annotated overview of the project's directory structure, highlighting critical folders, entry points, and key file locations.

```
.
├── app/                  # Next.js Application Directory - Contains page routes, layouts, and server components.
│   ├── posts/            # Dynamic route for blog posts.
│   │   └── [slug]/       # Dynamic segment for individual post slugs.
│   │       └── page.tsx  # Page component for displaying individual blog posts.
│   ├── favicon.ico       # Favicon for the application.
│   ├── globals.css       # Global styles for the application.
│   ├── layout.tsx        # Root layout for the application, defines shared UI.
│   └── page.tsx          # Root page component for the application's homepage.
├── public/               # Static assets served directly.
│   ├── milkyway.jpg      # Background image asset.
│   ├── smoke.png         # Image asset.
│   └── vite.svg          # SVG asset.
└── src/                  # Source code for reusable components and utilities.
    └── components/       # Reusable UI components.
        ├── DynamicUniverse.tsx # Dynamic component for universe visualization.
        ├── Universe.scss     # Styles for the Universe component.
        └── Universe.tsx      # Component for universe visualization.
```

## Critical Folders Summary

-   **`app/`**: The main Next.js application directory, organizing routes, UI, and logic.
-   **`public/`**: Stores static assets accessible directly by the browser.
-   **`src/components/`**: Contains reusable React components for building the application UI.
