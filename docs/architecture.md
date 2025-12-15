# Architecture Document

## Executive Summary

This project is a Next.js web application, classified as a monolith. It leverages React and TypeScript for development, with Tailwind CSS for styling. Deployment is configured via GitHub Actions to GitHub Pages. The project structure follows a component-based architecture.

## Technology Stack

**Primary Language:** TypeScript
**Frameworks:** Next.js 16.0.10, React 19.2.1, Tailwind CSS 4
**Build Tools/Linters:** ESLint 9, PostCSS 4
**Summary:** Next.js 16.0.10 (React) with TypeScript 5, Tailwind CSS 4

## Architecture Pattern

**Type:** Component-Based Architecture with Layered Client-Server (Next.js)

## Data Architecture

No explicit data models or migration files were found, suggesting either external data management or direct integration without a dedicated ORM/ODM layer.

## API Design

No explicit API contracts or dedicated API files were found. The application likely relies on client-side data fetching directly within components or uses implicit API patterns within server components.

## Component Overview

The UI is built using React components. The primary components identified are `DynamicUniverse.tsx` and `Universe.tsx` located in `src/components/`, which appear to be related to visualization or interactive elements.

## Source Tree Analysis

The project follows a standard Next.js application directory structure. Key directories include:

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

## Development Workflow

### Prerequisites

- Node.js version 18 or higher.
- pnpm (recommended package manager).

### Installation

```bash
pnpm install
# or npm install
```

### Running the Application

- **Development Server:** `npm run dev` (opens `http://localhost:3000`)
- **Production Preview:** `npm run preview`

### Building the Project

- `npm run build`

## Deployment Architecture

The project utilizes GitHub Actions for automated deployment to GitHub Pages. The `deploy.yaml` workflow handles:

- Checking out the repository.
- Setting up Node.js (v18).
- Installing dependencies.
- Building the project.
- Deploying the `dist` directory to a specified GitHub Pages repository (`../Po-Mato.github.io`).

## Testing Strategy

The project primarily uses `npm run lint` for code quality checks. No dedicated unit or integration test files were found in the codebase.
