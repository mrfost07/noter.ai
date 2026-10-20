# Noter.ai website

Public product site, downloads and documentation at **https://mrfost07.github.io/noter.ai/**.
This is separate from the desktop application's React frontend. It is a static, framework-free site with self-hosted fonts,
demo media, actual app screenshots, browser-local documentation search and no analytics or account requirement.

## Local development

Use Node.js 24. From this folder:

```sh
npm ci
npm test
npm run preview
```

Open http://127.0.0.1:3035/noter.ai/. Tests build `dist/`, validate generated page/resource/fragment links and release installer
mapping, and check the preview server's nested routes and video range support. After edits, run `npm run build` to refresh
the preview. `PORT` changes the preview port; `SITE_URL` changes the canonical deployment URL at build time.

## Content and releases

- `content/*.md`: guides, rendered with Marked at build time. Markdown is maintained by trusted repository contributors;
  arbitrary user HTML is not accepted by the website. Register a guide in `content/docs.mjs` to include it in navigation/search.
- `scripts/templates.mjs`: landing, download, documentation index, release and policy pages.
- `assets/site.css` and `assets/site.js`: responsive design and browser interactions.
- `data/release.json`: reviewed snapshot of a published GitHub release and the six installer assets. No runtime API calls
  or credentials are required for downloads.

For a new published release:

```sh
npm run update-release -- YY.MM.DD-rc.N
```

This fetches public GitHub release metadata and refuses missing/incorrect installer assets. Review the installation guides,
known limits and changelog copy for the new version before committing. Versions are deliberately not advanced automatically:
documentation and platform support need human review alongside the installer links.

## Deployment

`.github/workflows/noter-website.yml` builds and tests site changes in pull requests. On `main`, it uploads `dist/` and deploys
using GitHub Pages Actions. Repository Settings → Pages must use **GitHub Actions** as the build source. No personal access
token or hosting secret is needed. GitHub Pages handles HTTPS and media byte-range requests.

The source demo is the approved `Noter.ai-Motion-Refined.mp4`. The checked-in 720p/30fps web derivative preserves its complete
186.1-second timeline and audio, with `faststart` metadata, and is about 19 MB. Nothing autoplays before the user opens the demo.
The film includes on-screen explanatory text; the guides also explain its workflows in text. The original full-resolution
film and recording source files are not modified by website builds.

Manrope is bundled under the SIL Open Font License in `assets/fonts/OFL.txt`. The app icon uses the existing Noter.ai brand. The three product screenshots were supplied by the maintainer for this website.
Design tokens and content principles are in `DESIGN.md`.
