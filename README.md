# Sheetsleuth

Sheetsleuth is a Session 0 placeholder for a spreadsheet safety check used by AI agents.

## What exists now

- `apps/web` contains a static Sheetsleuth placeholder page at `/sheetsleuth/`.
- `packages/core` contains the TypeScript workspace and model types.
- `packages/cli` contains a small CLI helper for describing a workbook.
- The repository has npm, Docker, GitHub Actions, and starter project checks.

Spreadsheet detectors and reports do not exist yet. Converted `.xls` fidelity is not implemented yet; when it is added, the comparison will be LibreOffice checked against LibreOffice only.

## Setup

Use Node.js 22.23.3, then install the locked dependencies:

```sh
npm ci
```

## Run

Start the placeholder page:

```sh
npm run dev
```

Open <http://localhost:4173/sheetsleuth/>.

## Test and build

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run check:starter
npm run check:project
```

The current repository scripts also include these CI checks:

```sh
node scripts/build-docs.mjs --check
node scripts/check-trailers.mjs
node scripts/check-lockfile.mjs
```

## Judge check

The rebuild check uses the pinned Node image and runs the test suite in a network-disabled container:

```sh
scripts/judge-check.sh
```

Equivalent command:

```sh
docker build -t x . && docker run --rm --network none x npm test
```

## GitHub Pages

1. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.
2. Push to `main`, or run **Deploy Pages** from the Actions tab with **workflow_dispatch**.
3. The workflow installs dependencies, builds the workspaces, and deploys `apps/web` as the Pages artifact at `/sheetsleuth/`.
