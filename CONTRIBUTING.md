# Contributing to Noter.ai

Contributors and prospective maintainers are welcome. Noter.ai focuses on a calm notebook, useful AI assistance, and dependable meeting capture and review.

## Start here

- Check [open issues](https://github.com/mrfost07/noter.ai/issues) and [release status](docs/RELEASE_STATUS.md) for current priorities.
- Report bugs with the app version, operating system, reproduction steps, and expected behavior. Remove credentials, private notes, participant details, and recordings from public reports.
- Discuss larger features in [Discussions](https://github.com/mrfost07/noter.ai/discussions) before implementing them, so the work fits the notebook and meeting workflow.
- Documentation, accessibility, translations, testing, and platform fixes are valuable contributions too.

## Development and pull requests

Follow [AGENTS.md](AGENTS.md) for repository conventions and [desktop/README.md](desktop/README.md) for native prerequisites and build commands. Use the pinned toolchain versions and locked dependencies.

The [contributor verification guide](docs/CONTRIBUTOR_VERIFICATION.md) provides a clean-checkout container setup, persistence checks and test-environment requirements. Keep behavior changes and their regression tests in focused commits so reviewers can reproduce each change independently.

Keep each pull request focused on one problem. Explain the resulting behavior, include relevant test results, and add screenshots for visual changes. Add meaningful regressions for behavior fixes. Never commit provider credentials, user profiles, notes, or recordings.

Run checks for the surfaces you change:

```sh
pnpm --dir web lint
pnpm --dir web test --maxWorkers=2
pnpm --dir web build
go mod tidy -go=1.27.2
go fix -diff ./...
golangci-lint run
go test -race -p 2 ./server/... ./core/... ./provider/... ./cmd/...
node --test desktop/scripts/build-desktop.test.mjs
```

For native changes, build and test on the affected platform. CI runs the full platform matrix; successful packaging does not replace physical microphone, screen capture, playback, and upgrade testing. Read [release status](docs/RELEASE_STATUS.md) before testing a candidate with important data.

## Help maintain the project

Start a [discussion](https://github.com/mrfost07/noter.ai/discussions) with the area you would like to maintain, relevant experience, and the time you can offer. Begin with a focused contribution or issue triage. The project owner, [mrfost07](https://github.com/mrfost07), coordinates scope, reviews, releases, and maintainer access.

Possible areas include frontend and accessibility, meeting capture, AI providers, Windows/macOS/Linux packaging, documentation, and release testing.

## License

Contributions are made under the project's [MIT license](LICENSE). Preserve existing copyright and license notices.
