// Inline src/index.html and everything it references into one
// self-contained lathe.html: no network, no sibling files. That single
// file is what gets shared, hosted, or opened in a webview (Muse, Facebook).
//
//   node tools/build.mjs            -> lathe.html
//   node tools/build.mjs out.html   -> out.html
//
// Same packaging as the webview-tested prototype: fonts as data: URIs in
// the CSS, Three.js as a base64 data: script, our own scripts inline.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const out = resolve(root, process.argv[2] || "lathe.html");

const read = (p) => readFileSync(join(src, p), "utf8");

function inlineCss(rel) {
  const base = dirname(rel);
  return read(rel).replace(/url\("([^"]+\.woff2)"\)/g, (_, f) => {
    const b64 = readFileSync(join(src, base, f)).toString("base64");
    return `url("data:application/octet-stream;base64,${b64}")`;
  });
}

let html = read("index.html");
html = html.replace(/\s*<!-- Dev entry:[\s\S]*?-->/, "");
html = html.replace(/<link rel="stylesheet" href="([^"]+)" \/>/g, (_, href) => `<style>\n${inlineCss(href)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, s) => {
  const code = read(s);
  if (s.startsWith("vendor/")) {
    return `<script src="data:application/javascript;base64,${Buffer.from(code).toString("base64")}"></script>`;
  }
  return `<script>\n${code.replace(/<\/script/gi, "<\\/script")}</script>`;
});

/* Licensed assets (the shop cat) live in a private repo, checked out to private-assets/
   by CI with a token and never committed here. When present they go in scrambled, not as
   plain .glb/.png files, as the store licence asks; src/js/assets.js unscrambles them.
   Without them the build still works and the game simply has no cat. */
const PRIVATE = [
  ["cat.glb", "cat/cat.glb"],
  ["cat.png", "cat/cat_orange.png"],
];
const KEY = Buffer.from("bdub-woodturning-shop-assets-v1");
const scramble = (buf) => { const o = Buffer.alloc(buf.length); for (let i = 0; i < buf.length; i++) o[i] = buf[i] ^ KEY[(i * 7 + (i >> 5)) % KEY.length]; return o.toString("base64"); };
const found = {};
for (const [id, rel] of PRIVATE) {
  const p = join(root, "private-assets", rel);
  if (existsSync(p)) found[id] = scramble(readFileSync(p));
}
const nAssets = Object.keys(found).length;
html = html.replace("</head>", `<script>window.WT_ASSETS=${JSON.stringify(found)};</script>\n</head>`);

if (/(?:src|href)="(?!data:)[^"#]+"/.test(html)) throw new Error("build left an external reference in the output");
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB, private assets: ${nAssets ? Object.keys(found).join(", ") : "none"})`);
