# Noter.ai

<img src="./web/public/noter-icon-v2.png" alt="Noter.ai icon" width="96" align="right">

**A little space to think.**

Noter.ai is an AI-assisted notebook with editable Markdown notes, folders, meeting transcripts and searchable recordings. Organize a conversation into important details, decisions, dates and action items, review the draft, then save it to your notes.

[Desktop downloads](https://github.com/mrfost07/noter.ai/releases) · [Desktop build guide](desktop/README.md) · [Release status and known issues](docs/RELEASE_STATUS.md)

## Features

- A tabbed notebook with Markdown editing, formatted preview, drafts and folders.
- A compact meeting companion with separate microphone and shared-audio transcription channels.
- Optional screen recording, local library storage, video playback and searchable timestamped transcripts.
- AI-organized meeting drafts with recording links, and readable answers to meeting questions.
- Persistent provider/model settings, including Groq Whisper transcription and supported AI connections.
- Managed Markdown copies and recordings stored on your device.

## Desktop downloads

Installers are attached to [GitHub Releases](https://github.com/mrfost07/noter.ai/releases) after successful candidate builds:

| Platform | Package |
| --- | --- |
| Windows x64 | Setup `.exe` and `.msi` |
| macOS Apple Silicon / Intel | Architecture-specific `.dmg` |
| Linux x64 | `.AppImage` and `.deb` — notes/review preview; live capture unavailable |

The first candidates are experimental. Read the [release status](docs/RELEASE_STATUS.md) for known functional issues, platform testing limits and signing status. Android APKs and automatic updates are not currently implemented.

## Build from source

The backend uses Go; the web app uses Node.js 24 and pnpm 11.0.1; desktop builds also require Rust and the platform's Tauri prerequisites.

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
```

Follow [desktop/README.md](desktop/README.md) to build your platform's installer. CI builds fresh frontend assets, embeds them into the Go sidecar and packages the native desktop app from the same committed revision.

For backend development:

```sh
pnpm --dir web release
go run -buildvcs=true ./cmd/memos --addr 127.0.0.1 --port 5230
```

Provider API keys are configured in the app and are not included in this repository or its release installers. Antigravity OAuth additionally requires local `NOTER_ANTIGRAVITY_CLIENT_ID` and `NOTER_ANTIGRAVITY_CLIENT_SECRET` configuration; see [release status](docs/RELEASE_STATUS.md). See [AGENTS.md](AGENTS.md) for repository commands and contribution conventions.

## License and attribution

Noter.ai is an independent project maintained by [mrfost07](https://github.com/mrfost07), derived from [Memos](https://github.com/usememos/memos). Original copyright notices and the [MIT license](LICENSE) are retained. Internal package paths and compatibility identifiers can still contain the upstream name.
