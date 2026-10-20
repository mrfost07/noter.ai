import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".ttf": "font/ttf",
};

export function createServer() {
  return http.createServer(async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      let url;
      try {
        url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (url === "/") {
        res.writeHead(302, { Location: "/noter.ai/" }).end();
        return;
      }
      if (url === "/noter.ai") {
        res.writeHead(301, { Location: "/noter.ai/" }).end();
        return;
      }
      if (url.startsWith("/noter.ai/")) url = url.slice("/noter.ai".length);
      if (url.includes("\0") || url.includes("\\")) {
        res.writeHead(400).end();
        return;
      }
      const target = path.resolve(root, `.${url}`);
      if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
        res.writeHead(403).end();
        return;
      }
      let file = target,
        info;
      try {
        info = await stat(file);
        if (info.isDirectory()) {
          if (!url.endsWith("/")) {
            res
              .writeHead(301, {
                Location: `${new URL(req.url, "http://localhost").pathname}/${new URL(req.url, "http://localhost").search}`,
              })
              .end();
            return;
          }
          file = path.join(file, "index.html");
          info = await stat(file);
        }
        if (!info.isFile()) throw new Error("Not a file");
      } catch {
        const html = await readFile(path.join(root, "404.html"));
        res.writeHead(404, { "Content-Type": types[".html"], "Content-Length": html.length });
        res.end(req.method === "HEAD" ? undefined : html);
        return;
      }
      const headers = {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      };
      let start = 0,
        end = info.size - 1,
        status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) {
          res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
          return;
        }
        if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
        else {
          start = Number(match[1]);
          if (match[2]) end = Math.min(Number(match[2]), info.size - 1);
        }
        if (start > end || start >= info.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
          res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
          return;
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
      }
      headers["Content-Length"] = Math.max(0, end - start + 1);
      res.writeHead(status, headers);
      if (req.method === "HEAD" || !info.size) {
        res.end();
        return;
      }
      const stream = createReadStream(file, { start, end });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end("Preview could not serve this file.");
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3035);
  createServer().listen(port, "127.0.0.1", () => console.log(`Noter.ai website: http://127.0.0.1:${port}/noter.ai/`));
}
