# Changelog

## Unreleased

These source changes are newer than the published `26.10.16-rc.4` installers.

### Fixed

- Reject transcription model overrides longer than 256 bytes, consistently with saved and meeting model settings.
- Keep meeting-note truncation on a valid UTF-8 boundary when long notes contain accented characters, CJK text or emoji.
- Close test-store database handles and cache workers before temporary-directory cleanup, preventing Windows SQLite fixture failures.
- Accept ordinary Windows short-name library paths while continuing to reject symbolic links and junctions.

### Development and verification

- Separate desktop startup, sidecar lifecycle, companion-window state, native library commands and smoke verification into responsibility modules while retaining existing regressions.
- Organize database-filter tests by feature without changing their assertions.
- Check environment-example drift and provide an explicit SQLite-only workstation test command.
- Verify that full database CI fails on unavailable Docker or requested container skips; keep the explicit workstation mode separate.
- Require passing pull-request checks and protect main against force-pushes and deletion.
- Verify account login, private Markdown/Unicode note content, anonymous-read denial and library persistence across container recreation.
- Use an explicit previous-server baseline for upgrade smoke tests and preserve full SQLite/MySQL/PostgreSQL coverage.

## 26.10.16-rc.4

Experimental unsigned desktop preview for Windows, macOS and Linux. Includes meeting recovery, bounded transcription queues, managed-note synchronization, recording links and keyboard/navigation fixes. Linux is a notes/review preview; platform capture and trusted signing remain limited.

See the [published release](https://github.com/mrfost07/noter.ai/releases/tag/26.10.16-rc.4) for installers and [release status](docs/RELEASE_STATUS.md) for verification evidence and acceptance limits.
