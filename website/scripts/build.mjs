import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { marked } from "marked";
import { articles } from "../content/docs.mjs";
import { home, downloadsPage, documentationHome, changelogPage, privacyPage, termsPage } from "./templates.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const out = path.join(root, "dist");
export const origin = (process.env.SITE_URL || "https://mrfost07.github.io/noter.ai/").replace(/\/?$/, "/");
export const repository = "https://github.com/mrfost07/noter.ai";
export const escape = (s = "") =>
  String(s).replace(/[&<>"']/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x]);
const cleanText = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const icons = {
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  play: '<path d="m9 5 11 7-11 7V5Z"/>',
  search: '<circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  note: '<path d="M6 3h9l4 4v14H6V3Z M14 3v5h5M9 12h7M9 16h5"/>',
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v8h4v-8H4Zm16 0h1v8h-4v-8h3Z"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  folder: '<path d="M3 6h7l2 3h9v12H3V6Z"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  github:
    '<path d="M9 19c-4 1-4-2-6-2m12 5v-4a3.5 3.5 0 0 0-1-3c3 0 6-1 6-5a4 4 0 0 0-1-3 4 4 0 0 0 0-4s-1 0-4 2a13 13 0 0 0-6 0C6 3 5 3 5 3a4 4 0 0 0 0 4 4 4 0 0 0-1 3c0 4 3 5 6 5a3.5 3.5 0 0 0-1 3v4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.note}</svg>`;

export function downloadAssets(release) {
  const choose = (part, suffix) => {
    const a = release.assets.find((x) => x.name.includes(part) && x.name.endsWith(suffix));
    if (!a?.url?.startsWith(`${repository}/releases/download/`)) throw new Error(`Missing or invalid release asset: ${part} ${suffix}`);
    return a;
  };
  return {
    windows: choose("x86_64-pc-windows-msvc", ".setup.exe"),
    msi: choose("x86_64-pc-windows-msvc", ".msi"),
    apple: choose("aarch64-apple-darwin", ".dmg"),
    intel: choose("x86_64-apple-darwin", ".dmg"),
    linux: choose("x86_64-unknown-linux-gnu", ".AppImage"),
    debian: choose("x86_64-unknown-linux-gnu", ".deb"),
  };
}

export function documentShell({ title, description, body, route = "", page = "home", depth = 0, absolute = false }) {
  const base = absolute ? origin : depth ? "../".repeat(depth) : "./";
  const url = origin + route;
  return `<!doctype html>
<html lang="en" data-root="${base}" data-page="${page}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}${title === "Noter.ai" ? " - Record once. Leave with clarity." : " - Noter.ai"}</title>
<meta name="description" content="${escape(description)}"><meta name="theme-color" content="#080B13">
<link rel="canonical" href="${escape(url)}"><link rel="icon" type="image/png" href="${base}assets/noter-icon.png">
<meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${origin}assets/demo-poster.webp"><meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="${base}assets/fonts/Manrope.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="${base}assets/site.css"><script src="${base}assets/site.js" defer></script>
</head><body><a class="skip-link" href="#main-content">Skip to content</a>
<header class="site-header"><div class="nav-wrap"><a class="brand" href="${base}" aria-label="Noter.ai home"><img src="${base}assets/noter-icon.png" width="32" height="32" alt=""><span>Noter.ai</span></a>
<nav class="primary-nav" id="primary-nav" aria-label="Main navigation"><a href="${base}#features">Features</a><a href="${base}download/" ${page === "download" ? 'aria-current="page"' : ""}>Download</a><a href="${base}docs/" ${page === "docs" ? 'aria-current="page"' : ""}>Docs</a><a class="github-link" href="${repository}">${icon("github")}<span>GitHub</span></a></nav>
<div class="nav-actions"><button class="search-trigger" type="button" data-open-search aria-label="Search documentation">${icon("search")}<span>Search docs</span><kbd>Ctrl K</kbd></button><button class="icon-button mobile-menu" type="button" aria-label="Open navigation" aria-controls="primary-nav" aria-expanded="false">${icon("menu")}</button></div></div></header>
${body}
<footer class="site-footer"><div class="footer-main container"><div><a class="brand" href="${base}"><img src="${base}assets/noter-icon.png" width="32" height="32" alt=""><span>Noter.ai</span></a><p>A little space to think.<br>A clearer way to leave a meeting.</p></div><div class="footer-links"><div><h2>Get started</h2><a href="${base}download/">Desktop downloads</a><a href="${base}docs/getting-started/">Quick start</a><a href="${base}docs/">Documentation</a></div><div><h2>In the open</h2><a href="${repository}">Source code</a><a href="${base}changelog/">Release notes</a><a href="${repository}/discussions">Community</a></div><div><h2>Project</h2><a href="${base}docs/development/">Contribute</a><a href="${base}privacy/">Privacy</a><a href="${base}terms/">Terms &amp; license</a></div></div></div><div class="footer-bottom container"><span>Maintained by <a href="https://github.com/mrfost07">mrfost07</a>.</span><span>Free and open source. Built with care.</span></div></footer>
<dialog class="search-dialog" aria-labelledby="search-title"><div class="search-heading"><h2 id="search-title">Search documentation</h2><button type="button" class="icon-button" data-close-search aria-label="Close search">${icon("close")}</button></div><label class="search-field">${icon("search")}<input id="docs-search" type="search" placeholder="Installation, meetings, AI connections..." autocomplete="off" aria-label="Search documentation"></label><p class="search-status" aria-live="polite">Start with a guide below.</p><ul class="search-results" aria-label="Search results"></ul><div class="search-help"><span>Arrow keys to browse</span><span>Esc to close</span></div></dialog>
<dialog class="video-dialog" aria-label="Noter.ai product demo"><div class="video-dialog-head"><span>Noter.ai in action · 3:06</span><button type="button" class="icon-button" data-close-video aria-label="Close demo video">${icon("close")}</button></div><video controls playsinline preload="none" width="1280" height="720" poster="${base}assets/demo-poster.webp"><source src="${base}assets/noter-demo.mp4" type="video/mp4"><p>Your browser cannot play the video. <a href="${base}assets/noter-demo.mp4">Download the demo</a>.</p></video></dialog>
<dialog class="image-dialog" aria-label="Noter.ai app screenshot"><div class="image-dialog-head"><p class="image-description"></p><button type="button" class="icon-button" data-close-image aria-label="Close enlarged screenshot">${icon("close")}</button></div><div class="image-scroll"><img alt=""></div></dialog>
</body></html>`;
}

export function sidebar(active, base, mobile = false) {
  const groups = [...new Set(articles.map((x) => x.group))];
  const nav = `<nav aria-label="Documentation">${groups
    .map(
      (g) =>
        `<div class="docs-nav-group"><h2>${g}</h2>${articles
          .filter((x) => x.group === g)
          .map((a) => `<a href="${base}docs/${a.slug}/" ${a.slug === active ? 'aria-current="page"' : ""}>${escape(a.title)}</a>`)
          .join("")}</div>`,
    )
    .join("")}</nav>`;
  return mobile
    ? `<details class="docs-mobile-nav"><summary>Browse documentation ${icon("chevron")}</summary>${nav}</details>`
    : `<aside class="docs-sidebar">${nav}<a class="docs-source" href="${repository}">${icon("github")}View source</a></aside>`;
}

export async function build() {
  const release = JSON.parse(await readFile(path.join(root, "data/release.json"), "utf8"));
  const assets = downloadAssets(release);
  const data = { release, assets, icon, escape, repository, origin };
  await mkdir(out, { recursive: true });
  await cp(path.join(root, "assets"), path.join(out, "assets"), { recursive: true });
  const pages = [];
  async function page(route, title, description, body, kind = "page") {
    const dir = path.join(out, route);
    await mkdir(dir, { recursive: true });
    const depth = route.split("/").filter(Boolean).length;
    await writeFile(path.join(dir, "index.html"), documentShell({ title, description, body, route, page: kind, depth }));
    pages.push({ route, title, description });
  }
  await page(
    "",
    "Noter.ai",
    "AI-assisted notes, meeting recordings and searchable transcripts. Free and open-source desktop software for Windows, macOS and Linux.",
    home(data),
    "home",
  );
  await page(
    "download/",
    "Download Noter.ai",
    "Choose the right Noter.ai installer for Windows, Apple Silicon or Intel Mac, and Linux.",
    downloadsPage(data),
    "download",
  );
  await page(
    "docs/",
    "Documentation",
    "Get started with notes, AI connections, meeting capture and recording review in Noter.ai.",
    documentationHome({ ...data, articles, sidebar }),
    "docs",
  );
  const search = [];
  for (const a of articles) {
    const md = await readFile(path.join(root, "content", `${a.slug}.md`), "utf8");
    let body = marked.parse(md, { gfm: true });
    const toc = [],
      seen = new Map();
    body = body.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, level, label) => {
      const text = cleanText(label),
        stem = text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      const n = seen.get(stem) || 0;
      seen.set(stem, n + 1);
      const id = n ? `${stem}-${n}` : stem;
      toc.push({ text, id, level });
      return `<h${level} id="${id}">${label}</h${level}>`;
    });
    body = body.replace(/<table>/g, '<div class="table-scroll"><table>').replace(/<\/table>/g, "</table></div>");
    const layout = `<main class="docs-layout container" id="main-content">${sidebar(a.slug, "../../")}${sidebar(a.slug, "../../", true)}<article class="doc-article"><div class="breadcrumb"><a href="../../docs/">Documentation</a>${icon("chevron")}<span>${escape(a.group)}</span></div><h1>${escape(a.title)}</h1><p class="doc-description">${escape(a.description)}</p><div class="prose">${body}</div><div class="doc-end"><a href="${repository}/blob/main/website/content/${a.slug}.md">Edit this page on GitHub</a><a href="${repository}/issues/new/choose">Report an issue</a></div><nav class="doc-pagination" aria-label="Previous and next guides">${articles.indexOf(a) > 0 ? `<a href="../${articles[articles.indexOf(a) - 1].slug}/"><small>Previous guide</small>${escape(articles[articles.indexOf(a) - 1].title)}</a>` : "<span></span>"}${articles.indexOf(a) < articles.length - 1 ? `<a href="../${articles[articles.indexOf(a) + 1].slug}/"><small>Next guide</small>${escape(articles[articles.indexOf(a) + 1].title)}${icon("arrow")}</a>` : "<span></span>"}</nav></article><aside class="doc-toc"><h2>On this page</h2>${toc
      .filter((x) => x.level === "2")
      .map((x) => `<a href="#${x.id}">${escape(x.text)}</a>`)
      .join("")}<a class="toc-download" href="../../download/">Get Noter.ai ${icon("download")}</a></aside></main>`;
    await page(`docs/${a.slug}/`, a.title, a.description, layout, "docs");
    search.push({ slug: a.slug, title: a.title, group: a.group, description: a.description, text: cleanText(body) });
  }
  await page("changelog/", "What is new", "Current Noter.ai releases, improvements and platform limits.", changelogPage(data));
  await page(
    "privacy/",
    "Privacy",
    "How the Noter.ai website, local library and configured AI providers handle information.",
    privacyPage(data),
  );
  await page("terms/", "Terms and license", "Noter.ai is free, open-source software available under the MIT license.", termsPage(data));
  await writeFile(path.join(out, "assets/search-index.json"), JSON.stringify(search));
  await writeFile(path.join(out, ".nojekyll"), "");
  await writeFile(
    path.join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((p) => `<url><loc>${escape(origin + p.route)}</loc></url>`).join("")}</urlset>`,
  );
  await writeFile(path.join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${origin}sitemap.xml\n`);
  await writeFile(
    path.join(out, "404.html"),
    documentShell({
      title: "Page not found",
      description: "Find your way back to Noter.ai.",
      body: `<main class="not-found container" id="main-content"><span>404</span><h1>This page wandered off.</h1><p>The notebook is still right here.</p><a class="button primary" href="${origin}">Back to Noter.ai</a><a href="${origin}docs/">Browse the documentation</a></main>`,
      absolute: true,
    }),
  );
  console.log(`Built ${pages.length} pages and ${search.length} searchable guides in ${out}`);
  return { pages, search, release, assets };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
