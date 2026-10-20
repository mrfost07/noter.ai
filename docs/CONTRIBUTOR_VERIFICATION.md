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

## Changes and provenance

Keep a real fix and its regression test in the same focused commit. For a refactor, preserve existing behavior tests and describe the moved responsibilities. Include commands and results in the pull request. Do not invent authors, timestamps, development activity or test results to improve a repository score. Do not flatten the development history when publishing a new release.

Noter.ai builds on an MIT-licensed [upstream application](https://github.com/usememos/memos). Its notebook/meeting adaptations, local recording library, AI connection work, desktop packaging and public website are changes made for this project; that does not make every line in the affected directories original. Identify the particular changes being offered when discussing commercial licensing, retain applicable notices, and distinguish existing upstream work from project-specific additions. A GitHub contributor list is not evidence of exclusive ownership or licensing eligibility.
