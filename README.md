# Noter.ai

<img src="./web/public/noter-icon-v2.png" alt="Noter.ai icon" width="96" align="right">

**A little space to think.**

Noter.ai is an AI-assisted notebook with editable Markdown notes, folders, meeting transcripts and searchable recordings. Organize a conversation into important details, decisions, dates and action items, review the draft, then save it to your notes.

[Website](https://mrfost07.github.io/noter.ai/) · [Desktop downloads](https://mrfost07.github.io/noter.ai/download/) · [Documentation](https://mrfost07.github.io/noter.ai/docs/) · [Desktop build guide](desktop/README.md) · [Release status and known issues](docs/RELEASE_STATUS.md) · [Changelog](CHANGELOG.md)

## Features

- A tabbed notebook with Markdown editing, formatted preview, drafts and folders.
- A compact meeting companion with separate microphone and shared-audio transcription channels.
- Optional screen recording, local library storage, video playback and searchable timestamped transcripts.
- AI-organized meeting drafts with recording links, and readable answers to meeting questions.
- Persistent provider/model settings, including Groq Whisper transcription and supported AI connections.
- Managed Markdown copies and recordings stored on your device.

## Desktop downloads

Get the [current experimental desktop preview](https://github.com/mrfost07/noter.ai/releases/latest), or use the [download page](https://mrfost07.github.io/noter.ai/download/) to choose the right installer.

Installers are attached to [GitHub Releases](https://github.com/mrfost07/noter.ai/releases) after successful candidate builds:

| Platform | Package |
| --- | --- |
| Windows x64 | Setup `.exe` and `.msi` |
| macOS Apple Silicon / Intel | Architecture-specific `.dmg` |
| Linux x64 | `.AppImage` and `.deb` — notes/review preview; live capture unavailable |

The first candidates are experimental. Read the [release status](docs/RELEASE_STATUS.md) for known functional issues, platform testing limits and signing status. Android APKs and automatic updates are not currently implemented.

[Code signing policy](CODE_SIGNING.md): Windows signing through SignPath Foundation is being prepared and requires eligibility approval. Current installers remain unsigned. [Privacy policy](PRIVACY.md).

After installing on Windows, use the Start menu shortcut or `Start-Noter.ai-Desktop.bat` in this checkout. `Start-Noter.ai-Browser.bat` opens the installed app's actual local server address in your browser; keep the desktop app open while using it. These launchers discover the installation and do not depend on the source folder's name. Browser access does not provide native desktop meeting controls.

## Build from source

For a browser-accessible notebook built entirely from this checkout, install Docker with Compose v2.20+ and run:

```sh
docker compose up --build --wait
```

Open **http://127.0.0.1:8081**. The build installs locked frontend dependencies and embeds the fresh frontend into the Go server. A named volume stores the profile/database and library together. `docker compose down` keeps this data; `docker compose down --volumes` deletes it. Optional port/build settings are in [.env.example](.env.example).

The root [compose.yaml](compose.yaml) is exercised by the [clean-checkout workflow](.github/workflows/noter-reproducibility.yml). Readiness is exposed at `GET /healthz` and checks the database connection; it does not establish hardware or provider-account acceptance.

This container is a browser/server environment, not the native desktop app. It does not provide the native meeting window, OS capture integration or desktop sign-in callbacks. Use the desktop installer for those workflows. See [contributor verification](docs/CONTRIBUTOR_VERIFICATION.md) for tests, container checks and backups.

The backend uses Go; the web app uses Node.js 24 and pnpm 11.0.1; desktop builds also require Rust and the platform's Tauri prerequisites.

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
```

Follow [desktop/README.md](desktop/README.md) to build your platform's installer. CI builds fresh frontend assets, embeds them into the Go sidecar and packages the native desktop app from the same committed revision.

Provider API keys are configured in the app and are not included in this repository or its release installers. Experimental desktop builds supply bundled reference installed-client OAuth configuration for account sign-in. Source builds can supply their own client. ChatGPT account sign-in and OpenAI API-key access are separate; see [AI connections](docs/AI_CONNECTIONS.md) and [release status](docs/RELEASE_STATUS.md). See [AGENTS.md](AGENTS.md) for repository commands and contribution conventions.

## Contribute

CI runs frontend type checking, lint, unit tests and builds; backend static checks, race tests and real database suites; measured source-coverage floors; dependency vulnerability checks; and a clean-checkout container smoke test. See the [verification guide](docs/CONTRIBUTOR_VERIFICATION.md), [AI request validation](docs/API_VALIDATION.md) and [measured coverage baseline](.github/coverage-baseline.json) for commands, evidence and limitations.

Frontend tests are in [web/tests](web/tests), with [Vitest configuration](web/vitest.config.mts) and [frontend CI](.github/workflows/frontend-tests.yml). Run `pnpm --dir web test:coverage --maxWorkers=2` to generate maintained-source coverage. For a workstation without Docker, `node scripts/local-test.mjs` runs the explicit SQLite-only path; see [environment and local-test instructions](docs/ENVIRONMENT_AND_LOCAL_TESTS.md) for platform scope and integration skips. `node scripts/check-env.mjs` checks configuration-documentation drift.

Noter.ai is an open-source project maintained by [mrfost07](https://github.com/mrfost07). Contributors and prospective maintainers are welcome: help improve notes, meeting capture, accessibility, AI integrations, documentation, and platform support.

Read the [contribution guide](CONTRIBUTING.md), browse [open issues](https://github.com/mrfost07/noter.ai/issues), or join [Discussions](https://github.com/mrfost07/noter.ai/discussions). To help maintain the project, start a discussion describing your experience and the area you would like to support.

## License

Noter.ai is available under the [MIT license](LICENSE).
