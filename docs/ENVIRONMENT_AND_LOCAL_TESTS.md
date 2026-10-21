# Environment settings and local test isolation

`.env.example` is an inventory of actual application, build and test settings. Its optional entries are commented out so copying it does not turn on desktop operations, bypass rate limits, change a database driver or suppress integration tests. Only Docker Compose automatically loads the root `.env`; Go, Vite, the native launcher and the website scripts require settings exported into their own process environment. Do not place credentials in tracked files.

## Separate configuration surfaces

| Surface | Settings | Behavior |
| --- | --- | --- |
| Root Compose | `NOTER_PORT`, `NOTER_BUILD_VERSION`, `NOTER_BUILD_COMMIT` | Host loopback port and image build metadata. Container server/profile settings are explicitly configured in `compose.yaml`; merely adding `MEMOS_*` to `.env` does not override those entries. |
| Go server | `MEMOS_*` profile entries | Viper maps bound server keys to uppercase names, replacing hyphens with underscores. `MEMOS_DRIVER` configures the server; bare `DRIVER` does not. The compatibility prefix is retained. |
| Native launcher | `NOTER_PORT`, `NOTER_DATA_DIR`, `NOTER_WEBVIEW_DATA_DIR`, `NOTER_LIBRARY_ROOT` | Optional preferred port and private storage paths. In native smoke mode, the three storage paths must be pre-created, separate subdirectories of the OS temporary directory. `NOTER_DESKTOP` is a marker the launcher passes to its child server, not a browser/server feature toggle. |
| AI connection/build | `NOTER_ANTIGRAVITY_CLIENT_ID`, `NOTER_ANTIGRAVITY_CLIENT_SECRET`, `NOTER_DESKTOP_GOOGLE_OAUTH_JSON` | Publisher-owned optional installed-client configuration; personal account tokens and ordinary provider keys belong in application settings. CI desktop builds require the installed-client JSON secret. Never substitute a web application's confidential client secret. |
| Vite | `DEV_PROXY_SERVER` | Local frontend development API proxy target. |
| Website | `SITE_URL`, `PORT` | Public website build origin and loopback preview server port; neither changes the notebook API. |
| Tests | `DRIVER`, `SKIP_CONTAINER_TESTS`, `NOTER_TEST_URL`, `MEMOS_TEST_IMAGE_BUILT`, `MEMOS_SMOKE_*` | Explicit driver selection, integration skips, disposable smoke target and image harness inputs. These are not ordinary user settings. |
| Legacy server scripts | `MEMOS_VERSION`, `MEMOS_INSTALL_DIR`, `MEMOS_SKIP_CHECKSUM`, `MEMOS_INSTALL_QUIET`, `MEMOS_UID`, `MEMOS_GID`, `MEMOS_DSN_FILE` | Legacy tarball installation/container-entrypoint inputs; separate from native desktop installers and the root non-root Compose image. |

The OS supplies `ProgramData`, `HOME`, `USERPROFILE` and `PATH`; Cargo owns `CARGO_TARGET_DIR`, and CI owns `CI`. They are individually classified in the checker instead of being advertised as application knobs. `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS` belongs to WebKit and is explicitly rejected by desktop smoke validation. `MEMOS_ENTRYPOINT_SWITCHED` is an internal legacy entrypoint recursion marker.

## Detect documentation drift

```sh
node scripts/check-env.mjs
node --test scripts/check-env.test.mjs scripts/local-test.test.mjs
```

The checker reads tracked source filenames using Git, then inspects only Go, Rust, JavaScript/TypeScript, shell source and root `compose.yaml`. Stage new source files before running it locally; all committed source is covered in CI. It extracts literal `os.Getenv`/`LookupEnv`, `process.env.NAME`/quoted bracket reads, Rust environment reads, Viper server keys, Compose substitutions and the legacy shell's explicit `MEMOS_` defaults/secret-file inputs. Every resulting name must have an assignment placeholder in `.env.example` or an individually justified OS/tooling classification. Missing variables fail the command and identify their source files. Actual environment values are never read or printed, and private `.env`, profiles, credentials, build outputs, dependency trees, generated bindings and test fixture source are not opened.

This is a scoped static drift guard, not a parser for every programming language or a credential scanner. It does not infer arbitrary dynamically constructed environment names or inputs read by third-party libraries. When introducing a new read style or a dynamic name, extend the inventory logic and its regression tests in the same change; review the runtime's documented configuration as well. GitHub Actions expressions, workflow-local variables and tool-owned build flags are reviewed in their workflow rather than copied wholesale into the app's `.env.example`.

## SQLite-only workstation checks

Install Go 1.27.3 and Node 24, then run from the repository root:

```sh
node scripts/local-test.mjs
# Optional race detector; requires a working CGo/C compiler toolchain:
node scripts/local-test.mjs --race
# Narrow iteration on selected packages:
node scripts/local-test.mjs -- ./store/...
```

The runner sets `DRIVER=sqlite`, `SKIP_CONTAINER_TESTS=1` and `GOMAXPROCS=2` only on its child `go test -count=1 -p 2` process. It overrides an inherited MySQL/PostgreSQL test choice without changing the caller's shell. SQLite tests use per-test temporary databases. No Docker daemon, live database server or AI provider account is needed; Go dependencies/toolchain must already be installed or available from the network/cache. This is not an offline dependency installer.

On Linux/macOS, the default package pattern is `./...`. On Windows, the default explicitly enumerates the maintained Go application packages (`cmd`, `core`, `filter`, `internal`, `markdown`, `provider`, `proto`, `server`, `store`), because `scripts/` includes POSIX shell installation tests that require a working Unix shell/toolchain and are exercised by Linux CI. The runner prints this distinction; it does not label Windows application checks as the entire repository suite. A targeted pattern is an explicit contributor choice and retains its normal platform prerequisites.

Container migration and MySQL/PostgreSQL cases are visibly skipped on this path. A zero exit is evidence only for the tests that ran; it does not replace the three-driver, race-enabled CI matrix or native hardware acceptance. The runner refuses `CI=true`/`CI=1` to prevent it accidentally replacing those integration gates. CI continues to run each driver explicitly without `SKIP_CONTAINER_TESTS`. Container fixtures fail under `CI=true`/`CI=1` if skipping is requested or Docker is unavailable; the full database gate cannot silently succeed with skipped integrations. The separate Linux/Windows workstation jobs deliberately set `CI=false` to verify the documented reduced mode with Docker unreachable.
