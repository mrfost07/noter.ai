import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { build, out, origin, downloadAssets } from "./build.mjs";
import { createServer } from "./serve.mjs";

const result = await build();
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : path.join(dir, e.name))))).flat();
}
const htmlFiles = (await files(out)).filter((f) => f.endsWith(".html"));

test("all pages, local resources and fragment links resolve under the GitHub Pages project path", async () => {
  const titles = new Set();
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const relative = path.relative(out, file).replaceAll("\\", "/");
    const pageURL = new URL(relative.endsWith("index.html") ? relative.slice(0, -10) : relative, origin);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${relative} needs one page heading`);
    const title = html.match(/<title>(.*?)<\/title>/s)?.[1];
    assert.ok(title && !titles.has(title), `${relative} title must be unique`);
    titles.add(title);
    assert.match(html, /<meta name="description" content="[^"]+"/);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = new URL(match[1].replaceAll("&amp;", "&"), pageURL);
      if (url.origin !== new URL(origin).origin || !url.pathname.startsWith(new URL(origin).pathname)) continue;
      let name = decodeURIComponent(url.pathname.slice(new URL(origin).pathname.length));
      if (!name || name.endsWith("/")) name += "index.html";
      const target = path.join(out, name);
      assert.ok((await stat(target).catch(() => null))?.isFile(), `${relative}: missing ${match[1]}`);
      if (url.hash && name.endsWith(".html")) {
        const destination = await readFile(target, "utf8");
        assert.ok(destination.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${relative}: missing fragment ${match[1]}`);
      }
    }
  }
  assert.equal(htmlFiles.length, 18);
});

test("platform downloads require the correct six actual installers, never manifest files", () => {
  assert.equal(Object.keys(result.assets).length, 6);
  assert.match(result.assets.windows.url, /\.setup\.exe$/);
  assert.match(result.assets.apple.url, /aarch64-apple-darwin\.dmg$/);
  assert.match(result.assets.intel.url, /x86_64-apple-darwin\.dmg$/);
  assert.throws(() => downloadAssets({ ...result.release, assets: [] }), /Missing or invalid release asset/);
  assert.throws(
    () =>
      downloadAssets({ ...result.release, assets: result.release.assets.map((a) => ({ ...a, url: "https://example.com/installer.exe" })) }),
    /Missing or invalid release asset/,
  );
});

test("search includes every guide and the documented platform restrictions", async () => {
  const search = JSON.parse(await readFile(path.join(out, "assets/search-index.json"), "utf8"));
  assert.equal(search.length, 11);
  assert.equal(new Set(search.map((x) => x.slug)).size, 11);
  assert.match(search.find((x) => x.slug === "install-linux").text, /Live microphone and screen capture are unavailable/i);
  assert.match(search.find((x) => x.slug === "ai-connections").text, /separate/i);
  const media = await stat(path.join(out, "assets/noter-demo.mp4"));
  assert.ok(media.size > 1_000_000 && media.size < 25_000_000);
});

test("preview serves nested guides and seekable video ranges, and rejects malformed requests", async (t) => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/noter.ai/`;
  const guide = await fetch(`${base}docs/meetings/`);
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /<h1>Capture a meeting/);
  const direct = await fetch(`${base}docs/meetings`, { redirect: "manual" });
  assert.equal(direct.status, 301);
  const range = await fetch(`${base}assets/noter-demo.mp4`, { headers: { Range: "bytes=100-199" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-length"), "100");
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  const suffix = await fetch(`${base}assets/noter-demo.mp4`, { headers: { Range: "bytes=-32" } });
  assert.equal(suffix.status, 206);
  assert.equal((await suffix.arrayBuffer()).byteLength, 32);
  const invalid = await fetch(`${base}assets/noter-demo.mp4`, { headers: { Range: "bytes=999999999-" } });
  assert.equal(invalid.status, 416);
  const missing = await fetch(`${base}docs/missing/deep/`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), new RegExp(`${origin}assets/site.css`.replaceAll(".", "\\.")));
  const head = await fetch(`${base}assets/noter-demo.mp4`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const bad = await fetch(`${base}assets/%5c..%5cdata/release.json`);
  assert.equal(bad.status, 400);
});
