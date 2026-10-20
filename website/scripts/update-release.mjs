import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { downloadAssets, root } from "./build.mjs";

export async function updateRelease(tag) {
  if (!tag || !/^[0-9][a-zA-Z0-9.\-]+$/.test(tag)) throw new Error("Usage: npm run update-release -- 26.10.16-rc.4");
  const response = await fetch(`https://api.github.com/repos/mrfost07/noter.ai/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Noter.ai-website" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}). Existing snapshot has not changed.`);
  const data = await response.json();
  if (data.draft) throw new Error("A draft release cannot be advertised on the public website.");
  const release = {
    tagName: data.tag_name,
    name: data.name,
    url: data.html_url,
    publishedAt: data.published_at,
    isPrerelease: data.prerelease,
    assets: data.assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
  };
  downloadAssets(release);
  const current = JSON.parse(await readFile(path.join(root, "data/release.json"), "utf8"));
  if (current.tagName !== release.tagName) console.log("Review the installation docs and changelog for this release before committing.");
  await writeFile(path.join(root, "data/release.json"), `${JSON.stringify(release, null, 2)}\n`);
  console.log(`Updated installer links to ${release.tagName}.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await updateRelease(process.argv[2]);
