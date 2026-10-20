# Sheetsleuth: build spec (v3, after judge round 2)

**Headline:** an AI agent has to pass this check before it can say a spreadsheet edit is done.

Sheetsleuth compares a workbook before and after an edit and returns a verdict:
- **block:** the edit broke a formula or moved a result too far
- **review:** logic changed somewhere you didn't intend
- **pass:** everything else

It measures how much each problem changes the results, and offers a fix only after recalculating to prove the fix works.

The same engine runs in three places:
- as a command an agent calls
- in the browser, where files never leave the machine
- in CI

Its detectors catch the classic spreadsheet mistakes, such as an average that skips rows (the shape of the Reinhart-Rogoff error) or gene names turned into dates.

## Changes in v3 (from judge round 2)

**Budget.** The judges estimated 8 to 13M tokens and the builder has about 5.5M.
- Stage A is cut to what fits, and everything else moves to Stage B.
- Stage B items are built only if tokens remain or refill. Check `omnirush buildathon` for the 10M the event page promised.

**Story.** The agent gate is the headline everywhere, and the averaging error is the proof underneath it.

**Real evidence.** A 200-file Enron slice is scanned in Stage B item 1, the first thing done if tokens allow. The precision figure comes with all graded rows and a Wilson interval. The README also states that fidelity on converted .xls files is only LibreOffice checked against LibreOffice.

**Demo.** OmniRush itself calls `sheetsleuth verify-edit` as a shell command while editing a model workbook. It gets blocked, fixes its edit, and passes. This is recorded in a session and shown in the video. It uses the CLI, not MCP, because MCP is turned off in the OmniRush app.

**Stage A detectors:** D1, D2, D3, D5, D7, D8, D9, D10. D4, D6, D11 and D12 move to Stage B.

**Stage A reports:** JSON, text and Markdown. SARIF, HTML and the MCP server move to Stage B.

**Fixes from round 2:**
- **Fixture spec flags.** Fixtures can carry `excludeFromFidelity` (circular, manual-calc and intentionally stale cells). Those are asserted separately, and every other cell must still have zero mismatches.
- **Loan fixture.** It's built so Excel's and LibreOffice's approximate-match search return the same wrong row, and a test pins it.
- **D10 note.** D10's doc notes that HGNC renamed these genes in 2020: SEPT* to SEPTIN*, MARCH* to MARCHF*, DEC1 to DELEC1.
- **Samples and CSP.** Samples ship as a generated JS module that exports the bytes as `Uint8Array`, with no fetch. A test fails if the built bundle contains `fetch(`.
- **Tests and CI.** Vitest `testTimeout` is 60000. CI uses native `ubuntu-24.04-arm` runners, not QEMU.
- **Lockfile regeneration.** Delete `node_modules` and the lockfile first, regenerate inside Linux, then CI checks that the lockfile contains the linux x64 and arm64 rollup and esbuild packages.
- **Commit trailer check.** Skips merge and bot commits.
- **Starter template.** Its files are merged, not overwritten. Project skills live in `.agents/skills/` and are synced with `npm run setup`.
- **Session 0 deploy.** Session 0 deploys a placeholder Pages site and a stub README, so the submission never points at a dead link.

- Track: Research, Data & Scientific Computing.
- Repo: `github.com/kinnuworks/sheetsleuth`, MIT.
- Live: `kinnuworks.github.io/sheetsleuth`.

## Decisions

| Question | Answer |
|---|---|
| Build tool | OmniRush only. Every line of code comes from OmniRush sessions, and editor autocomplete stays off. |
| Builder reads TypeScript? | Assume no. Every session ends with commands whose output proves it worked. |
| Hosting | GitHub Pages through Actions. |
| Name | Sheetsleuth |
| Real spreadsheets | None. Fixtures are synthetic or labelled reconstructions. |
| Video | On hold |
| Scope | Full plan, built in two stages. Stage A is the polished core and is the submission. Stage B adds extras one at a time, and each merges only when it is finished and tested. The README lists only what exists, and unfinished items stay under "Roadmap". |

## 1. Claims and how we word them

The judges include people who know these cases. Every claim is worded exactly as its source supports it.

1. **Reinhart and Rogoff (2010).**
   - Herndon, Ash and Pollin (2013) found the authors' spreadsheet averaged rows 30 to 44 instead of 30 to 49, dropping five countries.
   - That coding error alone accounts for about 0.3 percentage points of the gap.
   - The headline change from -0.1% to 2.2% comes from all their corrections together, including excluded data and weighting.
   - Sheetsleuth's sample is a labelled reconstruction of the error's shape. It reports its own number, and the page says so.
   - Sources: https://retractionwatch.com/2013/04/18/influential-reinhart-rogoff-economics-paper-suffers-database-error/ plus the PERI working paper.
2. **Gene names.** Ziemann et al. (2016) found gene-name conversion errors in 19.6% of articles that had supplementary Excel gene lists (https://genomebiology.biomedcentral.com/track/pdf/10.1186/s13059-016-1044-7).
3. **Enron corpus.** Hermans and Murphy-Hill report that roughly a quarter of spreadsheets with formulas contain an Excel error value such as #DIV/0! or #REF! (https://arxiv.org/pdf/1503.04055). Our own corpus numbers replace this once the scan has run.
4. **Saved values.** Fixture cached values come from LibreOffice. The UI says "checked against the values saved in this file", never "Excel's values".

## 2. Judging rules this is built around

From https://omnirush.ai/buildathon.

**It works.**
- The README never claims what the code doesn't do.
- Detectors are tuned so a normal, clean budget workbook produces at most 2 findings at default settings.

**It's worth using.** The landing page opens on a finished analysis, not an empty drop zone.

**It rebuilds.**
- The judges' command must pass on amd64 and arm64: `docker build -t x . && docker run --rm --network none x npm test`.
- The lockfile is generated inside Linux.
- The base image is pinned by multi-arch index digest.
- Nothing timing-based or randomly seeded runs in `npm test`.

**OmniRush built it.**
- The project starts from omnirush-starter and uses its skills.
- Every swarm opens with a lead step that owns shared files.
- Every commit carries `Session:` and `Agent:` trailers.
- Each session ends with a written review and a handoff.

## 3. Repository layout

```
sheetsleuth/
  package.json  package-lock.json  .nvmrc (22.23.3)
  Dockerfile  .dockerignore  .env.example  LICENSE
  README.md  PROJECT.md  AGENTS.md  SESSIONS.md
  .agents/skills/sheetsleuth-detector/     custom skill: add a detector the house way (synced by npm run setup)
  docs/
    ARCHITECTURE.md  SUPPORTED_FUNCTIONS.md (generated)  LIMITS.md  CORPUS.md  DECISIONS.md
    detectors/D*.md   one file per detector, concatenated into DETECTORS.md by a script
    reviews/session-N.md
  packages/core/src/
    model/      shared types: Workbook, Cell, Value, Finding, Fix, Impact (written first, by the lead)
    xlsx/       read.ts, write.ts (fixed-file writer), safety.ts
    formula/    tokenizer, parser, printer, r1c1
    graph/      dependency graph, Tarjan SCC
    eval/       evaluator core + functions/{math,logic,lookup,text,date,finance,stats}.ts
    detect/     D*.ts, auto-discovered by registry (nobody edits a central list)
    impact/  fix/  report/
    gate/       verify-edit: compares a workbook before and after an edit
    diff/  export/          Stage B
  packages/cli/
  packages/mcp/             Stage B: stdio MCP server exposing check / verify_fix / verify_edit
  apps/web/
  fixtures/
    specs/*.json  xlsx/*.xlsx  expected/*.json  handmade/ (shared-formula, manual-calc, _xlfn cases)
  scripts/
    gen-fixtures.mjs  judge-check.sh  check-trailers.mjs  build-docs.mjs  corpus-scan.mjs  bench.mjs
```

## 4. Engine (Stage A)

### 4.1 Reader

**Limits.** A file is rejected if any of these hold:
- more than 10,000 zip entries
- more than 200 MB uncompressed
- any entry with a compression ratio above 200:1
- any `<!DOCTYPE` in the XML

**What it reads:**
- the workbook, rels, shared strings and styles (number formats, including date formats)
- sheets, defined names, `calcPr` and hidden state
- shared formulas: expanded by shifting relative references
- `_xlfn.` and `_xlws.` prefixes: stripped
- array formulas and structured references: kept, but marked unsupported

**Errors.** All errors are typed and readable. Nothing throws past the public API.

### 4.2 Formula language

- **Tokenizer:**
  - A1 references (absolute and relative), whole-row and whole-column references, and sheet-qualified references including quoted names
  - defined names, array constants, all operators and error literals
  - range, union and intersection operators
- **Parsing:** a Pratt parser builds a typed AST with source spans.
- **Printer:** turns the AST back into formula text.
- **R1C1 normaliser:** rewrites references relative to the host cell, so the same formula pattern in different rows compares equal.
- **Property tests:** fast-check with a fixed seed and a fixed number of runs. They cover the print/parse round trip and check that the tokenizer never throws.

### 4.3 Graph

- Range nodes are expanded lazily.
- Precedents and dependents are available both ways.
- Tarjan's SCC algorithm finds cycles, and topological order drives evaluation.

### 4.4 Evaluator

**Behaviour:**
- Follows Excel's value model, coercion rules and error values.
- Uses the 1900 date system, including the leap-year bug.

**Supported functions:**
- **Math:** SUM, AVERAGE, COUNT, COUNTA, COUNTBLANK, MIN, MAX, PRODUCT, SUMPRODUCT, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, POWER, SQRT, EXP, LN, LOG, LOG10
- **Logic:** IF, IFERROR, IFNA, AND, OR, NOT, CHOOSE
- **Conditional:** SUMIF, SUMIFS, COUNTIF, COUNTIFS, AVERAGEIF, AVERAGEIFS
- **Lookup:** VLOOKUP, HLOOKUP, INDEX, MATCH, XLOOKUP (exact match only)
- **Text:** CONCATENATE, CONCAT, LEFT, RIGHT, MID, LEN, UPPER, LOWER, TRIM, VALUE
- **Date:** DATE, YEAR, MONTH, DAY, EDATE, EOMONTH
- **Info:** ISBLANK, ISNUMBER, ISTEXT, ISERROR, ISNA
- **Finance:** NPV, PMT, FV, PV
- **Stats:** MEDIAN, STDEV.S, STDEV.P, VAR.S

`docs/SUPPORTED_FUNCTIONS.md` is generated from the registry, and CI fails if it drifts.

**Anything else is `Unverified(reason)`.** That includes unknown functions, volatile functions, arrays, structured references and external links. Unverified spreads to dependents, and the UI shows the reason instead of a number.

**Saved-value check:**
- Compare each supported formula cell with its cached `<v>`.
- Numbers match when `|a-b| <= 1e-9 * max(1, |a|, |b|)`. Other types must match exactly.
- The UI shows a fidelity line: "4,812 of 4,830 formulas match the values saved in this file; 18 use functions Sheetsleuth doesn't evaluate."
- The fixture suite requires zero mismatches.

### 4.5 Detectors

**Every finding has:**
- id, detector, severity, cells
- a plain title
- structured evidence
- a fix, where one exists

**Defaults and rules:**
- Default view shows high and medium. Low and info are behind a "show all" toggle.
- Each detector has at least 3 positive and 2 negative fixtures. The `noise-budget.xlsx` fixture is a clean, realistic budget and must produce at most 2 findings at default settings.

| ID | Name | Default severity | Rule and false-positive guards |
|---|---|---|---|
| D1 | Range stops short | high | An aggregate over a 1-D range next to a contiguous numeric block that extends past the range. The block ends at a blank, text, an aggregate, or a header-like integer (1900 to 2100 in the first row or column of the block). Also fires when sibling aggregates in the same row cover the full block and this one doesn't. Fix: extend the range. |
| D2 | Odd formula out | high | At least 3 cells in a run share an R1C1 form and one cell differs. The first and last cell of a run are exempt when they differ only in references to the run's own neighbour, such as an opening balance. Fix: use the majority form. |
| D3 | Typed value over formula | high | A constant inside a run where at least 3 neighbours share a formula. Fix: restore the formula. |
| D5 | Circular reference | high | An SCC larger than 1, or a self-loop. Info instead when iterative calculation is on. |
| D7 | Counted twice | high | An aggregate whose range contains a subtotal that aggregates other cells in the same range. Fix: exclude the subtotal. |
| D8 | Lookup on unsorted data | high | An approximate VLOOKUP, HLOOKUP or MATCH over a lookup column that isn't sorted. Fix: exact match, with the change shown. |
| D9 | Number stored as text | medium | A numeric-looking text cell inside a range that SUM or AVERAGE reads. Fix: convert the cell to a number. |
| D10 | Gene names turned into dates | high | A column of gene-like symbols in which some cells became dates or serial numbers matching known conversions (SEPT1-14, MARCH1-11, DEC1, RIKEN IDs). Fix: show the original symbol. |
| D12 | Stale results | medium | Manual calculation mode, or a large saved-value mismatch on fully supported cells. |
| D4 | Hidden constant | info | A numeric literal in a formula, excluding 0, 1, -1, 100, 12, 365, 7, 24, 60, 1000 and literal-argument slots. |
| D6 | Points at an empty cell | info | A direct reference to an empty cell that isn't formatted as an input. |
| D11 | Hidden input | low | A cell in a hidden sheet, row or column that feeds an output and is itself a constant (not a helper formula). |

### 4.6 Impact

**Output cells:**
- formula cells that nothing else depends on
- cells whose label matches `total|net|profit|loss|result|growth|average|mean|margin|balance|interest|irr|npv`

**For each fix:**
1. Clone the model and apply the fix.
2. Recompute the cells downstream of the change.
3. Report each output's old and new value, with the absolute and relative change.

**Ranking:** findings are ordered by the largest relative output change, then by severity. If an Unverified value is on the path, the result reads "not computed" with the reason.

### 4.7 Fix verification

A fix is "verified" only if all four hold:
1. No Unverified value is on the path.
2. Only cells downstream of the change changed.
3. The finding no longer fires.
4. No new finding of medium or higher severity appears.

Otherwise the fix is "suggested" and names the condition that failed.

### 4.8 Writer

- Edits only the changed `<f>` elements, removes their `<v>`, deletes `calcChain.xml` and its rel and content-type entries, and sets `fullCalcOnLoad="1"`.
- Refuses to edit a cell that belongs to a shared-formula group: it un-shares the group first, writing each member explicitly.
- Every other zip entry is copied byte for byte.
- A round-trip test proves only the targeted formulas changed.

### 4.9 Agent gate (the agentic part)

**What it is:** `verify-edit(before, after)` compares two versions of a workbook. It reports:
- every formula whose logic changed (R1C1 form)
- every constant that changed
- every new finding
- the output deltas caused by the edit

The verdict is `pass`, `review` or `block`.

**How the verdict is set:**
- `block`: any new high finding, or an output change larger than a threshold the caller sets
- `review`: logic changed in cells the caller didn't list as intended
- `pass`: otherwise

**Where it's available:**
- **CLI (Stage A):** `sheetsleuth verify-edit before.xlsx after.xlsx --intended "Summary!C4:C9" --max-output-change 5%`
- **MCP server (stdio), Stage B only:** the tools are `check(path)`, `verify_fix(path, findingId)` and `verify_edit(before, after, intended, maxChange)`. Each returns the stable JSON schema.

**Demo fixtures (`agent-edit-*.xlsx`):** before and after pairs, where an "agent" edits a model and:
- breaks a range (verdict: block)
- edits as intended (verdict: pass)
- changes unrelated logic (verdict: review)

**Pitch:** agents are starting to edit spreadsheets, and this is the check they run before claiming the edit is done.

### 4.10 Reports

- JSON, with a versioned schema
- SARIF 2.1.0, checked against the schema in tests
- Markdown
- Standalone HTML

## 5. CLI

```
sheetsleuth check <file> [--format text|json|sarif|md|html] [--fail-on high|medium|low] [--all] [--out f]
sheetsleuth fix <file> --finding <id> --out fixed.xlsx
sheetsleuth verify-edit <before> <after> [--intended range] [--max-output-change pct] [--format ...]
sheetsleuth scan <folder> --json out.json      (bulk scan, .xlsx only; .xls converted beforehand)
sheetsleuth functions
```

Exit codes:
- 0: clean or pass
- 1: findings at or above the threshold, or a block/review verdict
- 2: unreadable file

## 6. Web app

**Landing:**
- The page opens already showing the analysis of the averaging-error reconstruction, with the top finding expanded.
- Large type states the impact: "AVERAGE skipped 5 of 20 countries: result moves from X to Y. Fix verified."
- Below that are three more sample cards, each with its own one-line result:
  - **Loan model:** "$N of interest mispriced by an approximate VLOOKUP" (N computed from the fixture)
  - **Gene list:** "3 gene names turned into dates"
  - **Agent edit:** "Blocked: the edit broke a SUM range"
- Then a "Check your own file" drop zone and the privacy line.

**Screens:**
- **Results:** ranked findings on the left, a virtualised grid with highlighted cells on the right, the fidelity line, and a "show all" toggle.
- **Finding detail:** evidence, before and after formulas, the impact table, fix status, and "Download fixed workbook".
- **Verify an edit:** drop two files and get the gate verdict with reasons.

**Technical:**
- Analysis runs in a Web Worker, created with `new Worker(new URL(...), { type: 'module' })`.
- Vite `base: '/sheetsleuth/'` and a hash router, so deep links survive Pages.
- Samples are bundled as inline assets, with no fetch.
- In production only, a Vite plugin injects the CSP: `default-src 'self'; connect-src 'none'; worker-src 'self' blob:; img-src 'self' data:`. Dev mode stays unrestricted for HMR.
- Component tests use jsdom with the worker boundary mocked.

**Quality:**
- keyboard navigation and WCAG AA contrast
- works at 375 px
- light and dark themes
- one accent colour and the system font stack

## 7. Fixtures and tests

**`gen-fixtures.mjs`:**
1. Writes bare xlsx files from JSON specs.
2. Recalculates them with `soffice --headless --convert-to xlsx`.
3. Asserts every formula cell has a cached value.
4. Records `soffice --version` in each fixture's spec and in `docs/DECISIONS.md`.

If LibreOffice doesn't recalculate on conversion, the script falls back to a headless macro that runs `calculateAll()` before saving.

**`fixtures/handmade/`** holds files LibreOffice can't produce, edited at the XML level:
- shared-formula groups
- manual calculation mode
- `_xlfn.` prefixed functions
- array formulas

**`big-50k.xlsx`** is generated at benchmark time and isn't committed.

**Committed artifacts:** `fixtures/xlsx`, `fixtures/expected`, `fixtures/handmade` and `apps/web/src/samples.generated.ts` are committed. `npm test` and `npm run build` never call soffice, and `.dockerignore` must not exclude `fixtures/`.

**`npm test`** must be deterministic and offline. It covers:
- unit tests and seeded property tests
- the saved-value check across all fixtures (zero mismatches)
- golden findings per fixture
- the noise-budget ceiling
- security cases
- writer round trips, including shared groups and calcChain
- verify-edit verdicts on the agent-edit pairs
- CLI tests against the built binary
- web component tests

Not part of `npm test`:
- **`npm run bench`:** a timing check that the 50k-formula workbook analyses in under 3 s locally.
- **Coverage:** reported, but nothing gates on it.

## 8. Rebuild

**Dockerfile:**
- `FROM node:22.23.3-bookworm-slim@sha256:<index digest>`. Get the digest from `docker buildx imagetools inspect node:22.23.3-bookworm-slim`, and confirm the tag exists first.
- Copy the manifests and lockfile, then `npm ci`.
- Copy the rest, then `npm run build`.
- `CMD ["npm","test"]`.

**Lockfile:** generated inside `node:22.23.3-bookworm-slim` with Docker, so the Linux optional native packages are included. Rerun it whenever dependencies change.

**CI:**
- lint, typecheck and test
- the judge check on native `ubuntu-24.04` and `ubuntu-24.04-arm` runners
- docs drift check
- commit trailer check

**`judge-check.sh`:** runs the exact judge command and prints PASS or FAIL with the last 20 lines.

## 9. Stage B: extras, in priority order (the Enron corpus scan comes first)

Each extra merges only when it is complete, tested and documented. Until then the README lists it under Roadmap.

1. **Corpus scan.** Convert the Enron .xls files to .xlsx with LibreOffice outside the repo, run `sheetsleuth scan`, and publish one results table in CORPUS.md. The table gives counts per detector, with 20 random findings hand-checked to report a precision figure.
2. **Semantic diff screen.** Reuses the gate engine to show a full logic diff between two versions.
3. **Python export.**
4. **Dependency map screen.**
5. **GitHub Action**, publishing SARIF.

## 10. Documentation

**README order:**
1. Pitch and live link
2. Screenshot of the landing result
3. The problem, using the exact wording from section 1
4. Quick start: web, CLI, then the agent gate (an AGENTS.md snippet any agent can follow: run `node packages/cli/dist/index.js verify-edit` after editing a workbook). MCP, SARIF and HTML appear only under Roadmap until built
5. Detectors
6. How results are verified (the saved-value check and fix verification)
7. The rebuild command, with real judge-check output
8. Limits and supported functions
9. Built with OmniRush, linking SESSIONS.md and docs/reviews
10. Roadmap
11. Licence

**`SESSIONS.md`:** each row lists the session, goal, agents, skills used, and the `git log --grep "Session: N"` count.
