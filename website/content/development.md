Noter.ai is developed in public. Contributions to note editing, meeting capture, accessibility, AI connections, documentation and platform support are welcome.

## Get the source

```sh
git clone https://github.com/mrfost07/noter.ai.git
cd noter.ai
```

Read the repository's [AGENTS.md](https://github.com/mrfost07/noter.ai/blob/main/AGENTS.md) and [contribution guide](https://github.com/mrfost07/noter.ai/blob/main/CONTRIBUTING.md) before making changes.

## Desktop development

The current checkout uses Node.js 24, pnpm 11.0.1, Go 1.27.2 and Rust 1.99.0. Install the relevant Tauri platform prerequisites as described in the [desktop build guide](https://github.com/mrfost07/noter.ai/blob/main/desktop/README.md).

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop tauri:dev
```

The desktop builder compiles frontend assets and packages the embedded Go sidecar. It must build on the intended native platform; a Windows machine does not by itself verify Mac or Linux audio hardware behavior.

## Work on this website

The public site is in `website/` and deploys to GitHub Pages. Documentation is written in Markdown and compiled into ordinary static pages.

```sh
cd website
npm ci
npm run build
npm test
npm run preview
```

The preview prints its local URL. The static output is `website/dist/`. There is no browser framework or application backend required for the website.

## Propose a change

Keep pull requests focused. Describe the user-visible problem and resulting behavior, then include the checks you ran. For meeting changes, distinguish fixture tests from real device/provider testing.

Prospective maintainers can start a [discussion](https://github.com/mrfost07/noter.ai/discussions) describing an area they would like to support. The project owner coordinates reviews, releases and maintainer access.

## License

The project is available under its [MIT license](https://github.com/mrfost07/noter.ai/blob/main/LICENSE). Retain required notices when redistributing code.
