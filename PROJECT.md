# Sheetsleuth

Status: Session 0 setup is in progress. The first deliverable is a rebuildable monorepo and a Pages placeholder.

## Goal

- App: Sheetsleuth checks spreadsheet edits for AI agents and reports safe, actionable findings.
- Users: AI agents and the people reviewing their spreadsheet edits.
- First result: a strict, rebuildable workspace with a placeholder web page; the Stage A checking engine follows the repository layout in the spec.
- Source: `docs/SPEC.md`, “Changes in v3” and sections 2, 3, and 8.

## Choices

- Language and framework: TypeScript in npm workspaces; Vitest, ESLint, and Prettier.
- Where it will run: Node.js 22.23.3 for packages and a static web placeholder at `/sheetsleuth/`.
- Data it needs to keep: no persistent data in Session 0; spreadsheet fixtures and the checking engine are later work.
- Things we will leave for later: Stage B detectors/reports, MCP, corpus scan, and the full Stage A engine.

## Current task

- The user action and result we need: clone the repo, install dependencies, run the checks, and open a working placeholder Pages site.
- How we will check that result: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run check:starter`, `npm run check:project`, and `scripts/judge-check.sh`.
- Relevant files or components: root manifests and Dockerfile, `packages/core`, `packages/cli`, `apps/web`, `scripts/`, and `.github/workflows/`.
- Known failure or current baseline: Docker is not installed in the sandbox; CI's native amd64 and arm64 jobs are the rebuild proof. LibreOffice was installed locally for future spreadsheet compatibility checks.
- Remaining work and next step: add the workspaces, checks, CI, and placeholder, then run the full local verification.

Keep this section small. Update it as real checks and user feedback change the task.

## Commands

Record commands that work in this repo. Put executable app checks in `starter.config.json`.

- Start the app: `npm run dev --workspace apps/web` (static preview command to be added with the web workspace).
- Run app tests: `npm test`
- Check code style: `npm run lint`
- Check types, if used: `npm run typecheck`
- Build, if needed: `npm run build`

## Accepted decisions

Keep only decisions that matter for the next task. Add the reason in one short sentence.

For supplied meeting notes or earlier chats, add the source file or section. Separate agreed requirements, suggestions, and unresolved choices. Keep private excerpts in their private source location.

- Preserve the starter's files and scripts; the v3 spec explicitly requires merging the starter rather than replacing it.
- Use native `ubuntu-24.04` and `ubuntu-24.04-arm` CI jobs; the v3 spec rules out QEMU for the judge check.
- Keep the Session 0 site deliberately small and honest: it is a placeholder, not a claim that the spreadsheet engine is complete.
