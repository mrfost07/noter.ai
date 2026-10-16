# Noter.ai release status

The first desktop release is an **experimental release candidate**, not a production sign-off. It is built from the committed source in [mrfost07/noter.ai](https://github.com/mrfost07/noter.ai).

## Verified baseline

The October 15, 2026 local audit passed 1,428 frontend tests across 169 files, 20 backend packages, TypeScript and the frontend release build. Synthetic meeting capture, explicit AI draft review/save, two-part playback, transcript search/seek, export byte integrity and model persistence were exercised with local test providers. Windows library opening, folder-picker cancellation and compact meeting-window controls were exercised against the installed app.

These checks do not establish real-provider accuracy or hardware capture support on every operating system. Fresh CI results for each candidate are authoritative for the committed revision. Workstation audit screenshots, recordings, local account data and logs are excluded from this repository.

Meeting review now follows the latest passage across overlapping channels and recording parts. An isolated browser check exercised a first passage spanning the whole recording and confirmed that the highlight and transcript scroll advanced while the player stayed in place. Ask AI removes citation tokens and renders readable Markdown with progressive text reveal, cancellation, a request timeout and an immediate-display option. Desktop and 390-pixel layouts were checked with synthetic recordings and a local test provider. Progressive reveal is presentation after the provider responds, rather than provider streaming.

Candidate packaging also verifies native startup from each extracted installer with temporary data, library and WebView profiles. It requires the selected loopback page to load, an HTTP 200 response containing Noter.ai frontend HTML, SQLite initialization and termination of the owned sidecar. The GitHub matrix must pass these checks for every package before staging a release.

On October 16, live testing in the isolated local development preview completed Google authorization with the bundled reference installed client, loaded nine Antigravity models, and passed the AI connection request with Gemini 3.8 Flash (High). A separate ChatGPT registration completed with plan usage enabled, loaded seven account models, and passed a real Responses API connection request with GPT-6.1-Sol. The ChatGPT account and saved model remained selected after reloading settings without model detection. These results establish access for one tested account on this computer, not every account or platform. Windows packaged acceptance is recorded below; Mac and Linux still need physical installation/upgrade acceptance checks.

The **26.10.16-rc.3** candidate at `fea935132336ce14bf5df980e2541f4c5b58896f` subsequently passed the complete desktop CI workflow: frontend type/lint checks and regressions, backend race regressions, and native package extraction/startup/lifecycle tests for Windows, both Mac architectures and Linux. The local frontend run passed 1,448 tests in 171 files; all 15 packaging/verifier tests passed too. Downloaded Windows installer sizes and SHA-256 hashes matched the CI manifest. A fresh packaged-sidecar profile completed owner setup, supplied Google application configuration without environment credentials, contained no personal provider accounts, and retained a private test note across restart. The packaged app reused the saved ChatGPT account/model and completed a real AI request without reconnecting or detecting models; the saved Google account also loaded its live model catalog. These are one-account Windows checks, not a guarantee of every provider account or OS hardware configuration.

The installed Windows app was upgraded from **26.10.15-rc.1** to **26.10.16-rc.3** with the NSIS installer. Installation exited successfully, the registered version and installed sidecar identified RC3, and the installed sidecar matched the verified CI binary. All four existing profile/database/library-configuration files were byte-for-byte unchanged before the updated app was launched. A consistent private profile backup was retained. The maintainer confirmed AI settings were visible in the actual updated desktop window. Trusted Windows signing and Apple signing/notarization are still unavailable; this remains an experimental unsigned release.

## Known functional issues

- Reopening the meeting companion can lose its original meeting association and passage timing; organizing the recovered transcript can create a second meeting without video.
- Slow transcription requests can accumulate in an unbounded serial queue and delay stopping.
- Assistant edits can leave the managed Markdown copy on disk stale.
- Relinking a note can leave the previous meeting's note association inconsistent.
- A delayed local-file import can replace text in the newly active tab.
- Linked-note folder changes are not consistently reflected in meeting storage.
- Some accessible field labels, main notebook tab keyboard navigation and focus restoration are missing; meeting review tabs now support arrow keys. Narrow library navigation and short-height meeting panels still need layout fixes.

## Platform and distribution limits

**Antigravity is blocked for a supported public launch.** Google's [official FAQ](https://antigravity.google/docs/faq/#why-cant-i-use-third-party-software-such-as-claude-code-openclaw-or-opencode-with-my-antigravity-login) explicitly states that third-party applications cannot use Antigravity account authentication to access the service. Google OAuth production status and consent verification do not change that restriction. The current experimental provider must not be presented as a supported public account connection; use supported Gemini API/Enterprise access for public Google AI functionality. The maintainer has chosen to retain the experimental connection using the bundled reference installed client. This does not change Google’s position; real-account sign-in, model access and inference must still be checked, and this candidate must not be described as officially supported or production-ready.

The first release preparation replaces the legacy process-killing development launcher with the fresh build command and adds explicit native startup errors. These packaging fixes do not resolve the meeting recovery and note-consistency issues above.

- Windows installers, macOS disk images and Linux AppImage/Debian packages are desktop packages; Android APK packaging is not implemented.
- macOS and Linux installers are new build targets. Native capture, microphone/system-audio routing, meeting window behavior, playback codecs and provider authentication still require hardware testing on each platform.
- Linux live microphone and screen capture are unavailable in this candidate: WebKitGTK denies unhandled media permissions, and the current Tauri permission API does not expose the requesting frame's origin. This release does not grant media access broadly to work around that restriction. The Linux package is intended for note taking and review of existing recordings while safe capture support is developed.
- The folder picker and disk-space display are currently Windows-only. Other systems can retain the default library location.
- Initial candidates have no publisher certificate or Apple notarization. macOS builds use ad-hoc signing; Windows builds are unsigned. No trusted automatic update channel is configured.
- Official experimental desktop builds include reference installed-client configuration for one-click Antigravity sign-in; source builds can supply their own setup. ChatGPT account sign-in uses its own open-source OAuth registration, separate from API keys. Real provider authorization and inference must be verified per account. See [AI connections](AI_CONNECTIONS.md).
- The earlier October 16 Google attempt with the maintainer's own client was blocked with `403 access_denied` because that project was in Testing. The subsequent bundled-reference-client test succeeded as recorded above. This does not establish public Google approval, supported Antigravity access, or universal account eligibility.
- Keep backups of the profile/database and library together before testing upgrades. Installing an older executable alone cannot reverse database schema migrations.

## Promotion criteria

Fix the functional issues with regressions, pass required CI and packaged-app installation/upgrade tests, test real audio and a long recording session on each supported OS, configure platform signing/notarization, and verify profile/library backup and restoration before describing a release as production-ready.
