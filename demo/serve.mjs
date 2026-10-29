#!/usr/bin/env node
/**
 * The demo: two static servers, so the pages and what they load come from different origins (as on a real site
 * using a CDN), and neither is the web app's.
 *
 *   node demo/serve.mjs [--port 5790] [--content demo/content]
 *
 * - :5790, the host site: demo/*.html, the builds (/dist/), and three.js for the ESM page's import map
 *   (/node_modules/three/).
 * - :5791, the "CDN": the content folder (a project export from the studio, unzipped: head.glb, clips/), with CORS.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string" }, content: { type: "string" } } });
const port = Number(values.port ?? 5790);
const root = resolve(import.meta.dirname, "..");
const content = resolve(values.content ?? join(root, "demo", "content"));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".glb": "model/gltf-binary", ".webm": "audio/webm",
  ".mp3": "audio/mpeg", ".map": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function serve(base, routes, cors) {
  return (req, res) => {
    const url = new URL(req.url, "http://x");
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";
    const route = routes.find(([prefix]) => path.startsWith(prefix));
    const dir = route ? route[1] : base;
    const rel = route ? path.slice(route[0].length) : path;
    const file = normalize(join(dir, rel));
    const headers = cors ? { "Access-Control-Allow-Origin": "*" } : {};
    let stat;
    try {
      if (!file.startsWith(dir)) throw new Error("outside");
      stat = statSync(file);
      if (!stat.isFile()) throw new Error("not a file");
    } catch {
      res.writeHead(404, headers).end("not found");
      return;
    }
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) { // audio elements seek with range requests
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : stat.size - 1;
      res.writeHead(206, { ...headers, "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stat.size}` });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache" });
    createReadStream(file).pipe(res);
  };
}

createServer(serve(join(root, "demo"), [["/dist/", join(root, "dist")],
  ["/node_modules/three/", join(root, "node_modules", "three")]], false)).listen(port, () =>
  console.log(`host site:  http://localhost:${port}/  (script-tag.html, esm.html)`));
createServer(serve(content, [], true)).listen(port + 1, () =>
  console.log(`content:    http://localhost:${port + 1}/  (${content})`));
