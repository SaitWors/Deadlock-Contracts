// Build an isolated visual fixture from the real component and production styles.
// Usage, from frontend: node tests/build-card-layout.mjs /absolute/output/directory
import path from "node:path"
import fs from "node:fs/promises"
import { build } from "vite"

const target = path.resolve(process.argv[2] || "../.qa/card-layout")
await fs.mkdir(target, { recursive: true })
const result = await build({
  configFile: false,
  logLevel: "silent",
  publicDir: false,
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    write: false,
    minify: true,
    lib: { entry: "tests/card-layout-entry.tsx", name: "CardLayout", formats: ["iife"] },
  },
})
const code = result[0].output.find((item) => item.type === "chunk").code
const assets = path.resolve("dist/assets")
const files = await fs.readdir(assets)
const cssNames = files
  .filter((name) => name.endsWith(".css"))
  .sort((a, b) => Number(!a.startsWith("index-")) - Number(!b.startsWith("index-")))
let css = (
  await Promise.all(cssNames.map((name) => fs.readFile(path.join(assets, name), "utf8")))
).join("\n")
css = css.replace(/url\((['"]?)(?:\/assets\/|\.\/)?([^)'"/]+)\1\)/g, (match, quote, name) =>
  files.includes(name) ? `url("${path.relative(target, path.join(assets, name))}")` : match,
)
await fs.copyFile(
  path.join(
    assets,
    files.find((name) => name.startsWith("curator-optimized-") && name.endsWith(".webp")),
  ),
  path.join(target, "art.webp"),
)
await fs.writeFile(path.join(target, "fixture.js"), code)
await fs.writeFile(path.join(target, "fixture.css"), css)
await fs.writeFile(
  path.join(target, "index.html"),
  '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Card layout QA</title><link rel="stylesheet" href="fixture.css"><body style="margin:0;background:#08110c"><div id="root"></div><script src="fixture.js"></script><script>CardLayout.mount(document.getElementById("root"));</script></body></html>',
)
process.stdout.write(target + "/index.html\n")
