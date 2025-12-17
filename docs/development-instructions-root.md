# Development Instructions - Root

## Prerequisites

- Node.js version 18 or higher.
- pnpm (recommended package manager).

## Installation

```bash
pnpm install
# or npm install
```

## Running the Application

### Development Server

```bash
pnpm dev
```
(Opens [http://localhost:3000](http://localhost:3000))

### Static Build Preview (optional)

This project is configured for static export (`next.config.ts` → `output: "export"`).
After build, static files are generated in `out/`.

You can preview them with any static server.

## Building the Project

```bash
pnpm build
```

Optional preview examples:

- `npx serve out`
- `python3 -m http.server --directory out 3000`

## Testing

- **Linting:**
  ```bash
  pnpm lint
  ```
- No dedicated unit/integration test files were found.
