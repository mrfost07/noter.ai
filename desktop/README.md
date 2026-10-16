# Noter.ai desktop candidates

This directory packages Noter.ai's React interface and embedded Go server in a Tauri desktop application. The server binds to loopback, and notes and recordings remain on the device. AI and transcription use the providers configured in the app; local providers must be installed separately.

Experimental desktop installers supply bundled reference installed-client OAuth configuration so users only sign in with their own account. This installed-app configuration is public client metadata and extractable from the binary; confidential web secrets and personal provider tokens are never bundled. Release maintainers set `NOTER_DESKTOP_GOOGLE_OAUTH_JSON` in repository Actions secrets using the downloaded Desktop app (`installed`) JSON. CI rejects web clients and missing configuration. Source builds can supply their own application setup. ChatGPT account sign-in is separate from OpenAI API-key access. See [AI connections](../docs/AI_CONNECTIONS.md).

The current version is **26.10.16-rc.2**, an experimental candidate with no trusted publisher signature. macOS bundles use ad-hoc signatures and are not notarized. No automatic updater is configured.

## Build locally

Install Node.js 24, pnpm 11.0.1, Go 1.27.2, Rust 1.99.0, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows needs Visual Studio C++ Build Tools and WebView2. macOS needs Xcode command-line tools. Linux needs WebKitGTK 4.1 and the packages listed in the workflow.

From the repository root:

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop test:build
pnpm --dir desktop tauri:dev
```

To build and verify installers on the current native platform:

```sh
pnpm --dir desktop tauri:build
```

The builder always rebuilds the SPA into `server/frontend/dist` before compiling the Go sidecar. It injects the candidate version and Git commit, names the sidecar for the Rust target, runs `tauri build` with Cargo's `--locked`, extracts each installer, and checks its packaged sidecar. All subprocess failures stop the build.

Verified artifacts and manifests are written to `build/noter-desktop/<version>/<target>/`. That directory must be empty before a new build. Keep older candidates elsewhere or choose the next RC; the script refuses to overwrite a previous result. On Windows, artifact verification needs `7z` on PATH and `msiexec`. GitHub's Windows runner supplies these tools. DMG verification uses `hdiutil` and `codesign`; Linux uses `dpkg-deb` and the AppImage extraction flag.

`CARGO_TARGET_DIR` can point to a local build cache and `CARGO_BUILD_JOBS=2` can limit memory use. Neither setting selects older sidecar files. The legacy PowerShell preparation and launch scripts delegate to the portable build commands.

## GitHub candidate workflow

The [Noter.ai Desktop Candidate workflow](../.github/workflows/noter-desktop.yml) runs only when manually dispatched on committed `main` in `mrfost07/noter.ai`. Its version input must match `desktop/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the application entry in `src-tauri/Cargo.lock`. Update the macOS numeric `bundleVersion` and Windows `wix.version` at the same time. For `26.10.16-rc.2`, these are `26.10.16` and `26.10.16.2`, respectively. SemVer omits numeric leading zeroes; the Go server's calendar version pads months 1–9.

Frontend type/lint/format checks, frontend tests, and backend/meeting/provider tests with the race detector run alongside the native build matrix. Both must succeed for a release draft to be staged. Formatting failures block the candidate; they are never ignored.

Before dispatch, a maintainer must push the candidate's version tag at that exact committed revision (for example, `git tag 26.10.16-rc.2 HEAD` followed by `git push origin 26.10.16-rc.2`). Never move an existing candidate tag. This avoids GitHub rejecting workflow-token release creation when the new tag would also introduce workflow-file changes. The draft job verifies the tag still identifies the candidate commit before creating or resuming a draft.

| Native runner | Target | Packages |
| --- | --- | --- |
| Windows 2022 | Windows x64 | NSIS `.exe`, MSI |
| macOS 15 Apple Silicon | macOS ARM64 | DMG |
| macOS 15 Intel | macOS x64 | DMG |
| Ubuntu 22.04 | Linux x64 | AppImage, Debian `.deb` |

Each runner builds fresh embedded assets and runs native Rust regression tests. Windows/Linux extracted sidecars must match the fresh binary's SHA-256 exactly. macOS ad-hoc signing can rewrite Mach-O signature bytes, so the runner verifies bundle and sidecar signatures plus unchanged Go version, build metadata, and build ID. Manifests record the source and packaged hashes and the signing status.

Each extracted application is also launched with `--smoke-test` and three new temporary data/library/WebView directories. The wrapper must load its selected loopback page, initialize its own SQLite profile, exit successfully within the bounded test, and reap its sidecar. The verifier checks the native report, database header, and stopped process. Linux runs under Xvfb with the WebKit sandbox enabled; the AppImage uses its extracted launcher and library paths. macOS's packaged microphone usage description is checked. These launch tests do not create user accounts or start audio capture.

After every platform succeeds, a separate job rechecks all installer hashes, sizes, identities, and manifests. With `create_draft=true`, it stages an **unpublished prerelease draft** with six installers, four manifests, and `SHA256SUMS.txt`. A rerun can resume only a matching draft for the same commit with identical existing assets. It refuses to alter a published release, move an existing tag, or mix candidates. With `create_draft=false`, verified artifacts remain available on the workflow run.

Desktop candidates use their own packaging workflow. It does not publish the draft or enable an updater. Review the candidate and complete installation and physical-device acceptance tests before deciding whether to publish it.

## Runtime data and platform limits

The native wrapper stores its private server data in the operating system's application-data directory under `ai.noter.desktop`. Its default human-readable library is `Noter.ai` inside the user's home directory. Closing the desktop app stops its sidecar. Existing notes and provider settings are not bundled into installers.

Windows supports the native folder picker and free-space reporting. These two functions are not yet supported on macOS/Linux. Revealing a folder uses the operating system's file manager.

Microphone, shared-screen capture, internal audio, screen recording, and playback depend on each operating system and WebView. Internal-audio capture is not guaranteed on macOS. **Linux live microphone/screen capture is unavailable in this candidate**: WebKitGTK denies unhandled media permissions, and the current native callback cannot enforce the requesting frame's origin. The app does not grant capture broadly to external embedded content. The Linux package is a notes/review preview. CI verifies builds, archive contents, versions, hashes, and automated regressions; it does not certify physical microphones, provider accounts, OS permission prompts, or every distribution's media stack. Unsigned Windows candidates can trigger SmartScreen, and macOS Gatekeeper can require additional review because the app is not notarized.

Build design references: [Tauri sidecars](https://v2.tauri.app/develop/sidecar/), [Tauri CLI](https://v2.tauri.app/reference/cli/), [macOS bundle configuration](https://v2.tauri.app/distribute/macos-application-bundle/), [Linux media packaging](https://v2.tauri.app/distribute/appimage/), and [GitHub-hosted runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
