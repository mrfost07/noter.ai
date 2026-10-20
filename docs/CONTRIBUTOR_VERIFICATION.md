# Reproducing and verifying Noter.ai

## Clean-checkout browser/server build

Install Docker with Compose v2.20 or newer, clone this repository and run from its root:

```sh
docker compose up --build --wait
```

Open http://127.0.0.1:8081. No host Go, Node, pnpm, database or provider account is required to boot the notebook. The root Dockerfile installs locked frontend dependencies, builds the actual frontend, embeds it into the Go server and runs as UID/GID 10001. It does not download an upstream application image. `.env.example` documents optional overrides; no credentials are required to build.

The host port binds only to loopback. The container stores SQLite under `/data/profile` and the managed library under `/data/library`, together in the `noter-data` named volume. The health check calls `/healthz`, which pings the database. A healthy response alone does not prove audio hardware, AI credentials or every application flow works.

```sh
node scripts/container-smoke.mjs
docker compose down
```

The smoke check requires Node 24 and a running Compose project. It verifies database readiness, real frontend HTML and a referenced JavaScript bundle, a non-root runtime, initialized SQLite and library persistence after recreating the service. CI runs this from a clean checkout and deletes only its own temporary volumes afterward.

On a **disposable, empty profile only**, `node scripts/container-smoke.mjs --write-fixtures` also creates a randomly named account and a private note containing Unicode, Markdown, a task and a link. It checks exact content and visibility before and after container recreation, checks anonymous reads are denied, and verifies both the existing token and a new password login afterward. It refuses to create fixtures when the instance already has users. CI uses this opt-in mode with its own temporary Compose project; the default command does not create an account or note.

`Upgrade Smoke` separately seeds an older server image, upgrades its database and verifies that old and new notes remain readable. Its explicit default is the retained `neosmemo/memos:0.31.0` server baseline, with a manual-dispatch override for other supported server images. Desktop release tags are not server image names, and the reset main history cannot discover an ancestral server tag. The fixture image is used only for this compatibility test; it is not the image launched by the root Noter.ai Compose setup.

`docker compose down` preserves data. `docker compose down --volumes` deletes it. For a consistent backup, stop the service and back up the entire named volume, including both profile and library. Provider tokens and notes in that volume are private.

This is a browser/server environment. Native desktop windows, OS recording integration and desktop OAuth callbacks still require the [native prerequisites](../desktop/README.md). Docker is not a replacement for platform acceptance tests. Explicit container build arguments `VERSION` and `COMMIT` record source identity; an omitted version uses the UTC build month and an omitted commit is `unknown`.

## Native developer checks

Use Go 1.27.2, Node 24 and pnpm 11.0.1. Install frontend dependencies with `pnpm --dir web install --frozen-lockfile`.

```sh
pnpm --dir web lint
pnpm --dir web test --maxWorkers=2
pnpm --dir web build
go test -race -p 2 ./server/... ./core/... ./provider/... ./internal/...
node --test desktop/scripts/build-desktop.test.mjs
```

Frontend tests live under `web/tests`, not alongside `web/src`. `pnpm lint` includes both TypeScript checking and Biome. Backend CI exercises SQLite, MySQL and PostgreSQL; the latter two use Docker containers. `SKIP_CONTAINER_TESTS=1` explicitly skips those integrations on a workstation without Docker and must not be treated as a full passing database suite. Race tests require a working CGo toolchain.

For the explicit SQLite-only workstation runner and the categorized configuration inventory, see [Environment settings and local tests](ENVIRONMENT_AND_LOCAL_TESTS.md). CI exercises that runner with Docker unreachable as a separate check; it also preserves the full three-driver store matrix. `node scripts/check-env.mjs` prevents a statically referenced application setting from silently losing its example documentation. OS and build-tool variables are categorized separately.

## Coverage evidence

`pnpm --dir web test:coverage --maxWorkers=2` writes JSON, LCOV and text summaries under `web/coverage/`. Generated protocol bindings are excluded; maintained application code is included. CI retains the reports as artifacts alongside backend coverage profiles.

Backend CI uses `-coverpkg` to count calls across package boundaries. Its store job explicitly runs SQLite, MySQL and PostgreSQL with coverage flags and merges their execution evidence. The older all-driver `TestMain` wrapper starts child Go commands without forwarding coverage flags; running the wrapper under coverage alone underreports the actual store tests. `scripts/check-coverage.mjs merge` unions identical source blocks, checks their statement counts and emits a standard Go `mode: set` profile without counting shared statements multiple times.

The merge and gate calculations have their own tests:

```sh
node --test scripts/check-coverage.test.mjs
```

Coverage measures executed code, not assertion quality or production acceptance. Do not add tests that simply mirror the implementation or exclude maintained modules to make a percentage look better.

The enforced floors and their source CI runs are recorded in [`.github/coverage-baseline.json`](../.github/coverage-baseline.json). On October 20, the maintained frontend measured 72.17% lines, 71.12% statements, 61.95% functions and 62.44% branches. Backend statement coverage measured 79.58% for stores after combining all three drivers, 71.00% for server code, 79.17% for internal packages and 70.23% for the remaining group. Percentages are recomputed from execution counts and rounded for display. These are measurements, not invented targets.

CI fails if execution coverage falls below a configured floor, if a report is missing/malformed, or if a metric is absent. The local gate is independent of the optional Codecov upload. Reproduce it with:

```sh
node scripts/check-coverage.mjs frontend web/coverage/coverage-summary.json
node scripts/check-coverage.mjs store coverage.out
```

The second command needs the merged store report from CI (or equivalent explicit local driver runs). Explain baseline changes with new reports in the pull request; do not lower floors merely to conceal a regression.

## Dependency security

`.github/dependabot.yml` checks Go, web/desktop/website JavaScript, Rust, Actions and container base-image dependencies weekly. Compatible updates are grouped to keep review manageable; major updates remain separate and are not automatically merged.

Web, desktop and website updates have separate groups, each limited to two open version-update proposals. Babel and Node major migrations are deferred because their current proposals fail compatibility checks; compatible fixes still arrive. Audits independently check the installed dependency graph, so deferring a migration is not an advisory exemption. Existing bot branches are review proposals, not installed app updates. A failed proposal must be fixed or deliberately deferred before merging, even if its production build passes.

The Dependency Security workflow runs on every pull request to main, relevant dependency pushes, weekly and by manual dispatch. It blocks high/critical JavaScript advisories and reachable Go vulnerabilities. Audit/network failures fail the job instead of being reported as a clean scan. Reproduce the checks with:

```sh
pnpm --dir web audit --prod --audit-level=high
pnpm --dir desktop audit --audit-level=high
npm --prefix website audit --audit-level=high
# From the repository root, using the pinned Go toolchain:
go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
govulncheck ./...
```

The October 20 dependency update removed the high/moderate advisories identified in the web production dependency graph. The scan still reports a low-severity [KaTeX prototype-pollution advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7); its published fix requires a separate 0.18.x migration from the existing 0.16.x rendering stack. This finding is not hidden or allowlisted. A green high-severity audit is not a claim that no advisories exist. Recheck current registry/database results before a release.

See [AI API validation](API_VALIDATION.md) for existing request boundaries and the tests that exercise them.

## Main branch checks

Backend static checks and all four test groups, frontend lint/type checks/coverage and production build, desktop packaging regressions, JavaScript/Go advisory audits, and the real container smoke test run on every pull request to main. They intentionally have no pull-request path filter: a required check that never starts would leave an unrelated change permanently pending.

Native Rust changes also compile and run the existing pure lifecycle/path regression tests on Windows x64, Linux x64, and Apple Silicon/Intel macOS. The native workflow always reports `Desktop native verification`; its matrix runs only when native inputs change. A failed change-detection job or failed/cancelled native matrix fails the gate. These jobs use an explicitly non-executable sidecar resource only to satisfy the compiler's bundle metadata requirement. They never launch or distribute that fixture and do not establish native startup, capture, installer or real-provider acceptance. Candidate releases keep their separate real-sidecar build and native launch verification.

The branch protection policy in [`.github/main-protection.json`](../.github/main-protection.json) requires these named GitHub Actions checks and an up-to-date pull request. It blocks force pushes and deletion, applies to administrators, and requires review conversations to be resolved. No second human approval is required for this solo-maintainer repository. The repository owner can inspect the applied policy with `gh api repos/mrfost07/noter.ai/branches/main/protection` and restore it using `gh api --method PUT repos/mrfost07/noter.ai/branches/main/protection --input .github/main-protection.json`. The JSON file is the intended policy; the GitHub API response is the evidence that it is actually enabled.

These gates do not establish native hardware acceptance, Rust vulnerability coverage, exclusive rights to upstream code, or a third-party evaluation score. A 90/100 DataFactor result remains an external target, not a promise. Sustained genuine development history, original work with clear rights, and useful tested fixes are still needed; do not manufacture activity or increase coverage floors without execution evidence.

## Changes and provenance

Keep a real fix and its regression test in the same focused commit. For a refactor, preserve existing behavior tests and describe the moved responsibilities. Include commands and results in the pull request. Do not invent authors, timestamps, development activity or test results to improve a repository score. Do not flatten the development history when publishing a new release.

Noter.ai builds on an MIT-licensed [upstream application](https://github.com/usememos/memos). Its notebook/meeting adaptations, local recording library, AI connection work, desktop packaging and public website are changes made for this project; that does not make every line in the affected directories original. Identify the particular changes being offered when discussing commercial licensing, retain applicable notices, and distinguish existing upstream work from project-specific additions. A GitHub contributor list is not evidence of exclusive ownership or licensing eligibility.
