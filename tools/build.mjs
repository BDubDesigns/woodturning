// Inline src/index.html and everything it references into one
// self-contained lathe.html: no network, no sibling files. That single
// file is what gets shared, hosted, or opened in a webview (Muse, Facebook).
//
//   node tools/build.mjs            -> lathe.html
//   node tools/build.mjs out.html   -> out.html
//
// Same packaging as the webview-tested prototype: fonts as data: URIs in
// the CSS, Three.js as a base64 data: script, our own scripts inline.
import { readFileSync, writeFileSync } from "node:fs";
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

if (/(?:src|href)="(?!data:)[^"#]+"/.test(html)) throw new Error("build left an external reference in the output");
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
