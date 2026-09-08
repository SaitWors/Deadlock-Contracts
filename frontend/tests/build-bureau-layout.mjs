// Run from frontend after a production build. No external requests or login.
// Generates a fixture and 30 separately reusable SVG assets. Matte backgrounds
// are retained explicitly; export never fabricates an alpha mask.
import path from "node:path"
import fs from "node:fs/promises"
import vm from "node:vm"
import { build } from "vite"

const target = path.resolve(process.argv[2] || "../.qa/bureau-layout")
await fs.mkdir(path.join(target, "regalia"), { recursive: true })
const options = {
  configFile: false,
  logLevel: "silent",
  publicDir: false,
  resolve: { alias: { "@": path.resolve("src") } },
  define: { "process.env.NODE_ENV": '"production"' },
}
const result = await build({
  ...options,
  build: {
    write: false,
    minify: true,
    lib: { entry: "tests/bureau-layout-entry.tsx", name: "BureauLayout", formats: ["iife"] },
  },
})
await fs.writeFile(
  path.join(target, "fixture.js"),
  result[0].output.find((item) => item.type === "chunk").code,
)
const assets = path.resolve("dist/assets")
const files = await fs.readdir(assets)
const cssNames = files
  .filter((name) => name.endsWith(".css"))
  .sort((a, b) => Number(!a.startsWith("index-")) - Number(!b.startsWith("index-")))
let css = (
  await Promise.all(cssNames.map((name) => fs.readFile(path.join(assets, name), "utf8")))
).join("\n")
const referenced = new Set()
css = css.replace(/url\((['"]?)(?:\/assets\/|\.\/)?([^)'"/]+)\1\)/g, (match, quote, name) => {
  if (!files.includes(name)) return match
  referenced.add(name)
  return `url("assets/${name}")`
})
await fs.mkdir(path.join(target, "assets"), { recursive: true })
await Promise.all(
  [...referenced].map((name) =>
    fs.copyFile(path.join(assets, name), path.join(target, "assets", name)),
  ),
)
await fs.writeFile(path.join(target, "fixture.css"), css)
await fs.writeFile(
  path.join(target, "index.html"),
  '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR36 bureau QA</title><link rel="stylesheet" href="fixture.css"><body><div id="root"></div><script src="fixture.js"></script><script>BureauLayout.mount(document.getElementById("root"));</script></body></html>',
)

// Vite's library mode embeds the existing bitmaps; SVG exports are self-contained.
const catalogBuild = await build({
  ...options,
  build: {
    write: false,
    minify: false,
    lib: { entry: "src/regalia/catalog.ts", name: "RegaliaCatalog", formats: ["iife"] },
  },
})
const context = vm.createContext({})
vm.runInContext(catalogBuild[0].output.find((item) => item.type === "chunk").code, context)
const entries = Object.entries(context.RegaliaCatalog.REGALIA)
for (const [id, art] of entries) {
  if (!/^data:image\/webp;base64,[a-zA-Z0-9+/=]+$/.test(art.src))
    throw new Error(`Export expected an embedded bitmap: ${id}`)
  const [x, y, width, height] = art.box.split(" ").map(Number)
  if (
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > art.width ||
    y + height > art.height
  )
    throw new Error(`Out-of-bounds source rectangle: ${id}`)
  await fs.writeFile(
    path.join(target, "regalia", `${id}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384" viewBox="${art.box}"><defs><clipPath id="bounds"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath></defs><image clip-path="url(#bounds)" width="${art.width}" height="${art.height}" href="${art.src}"/></svg>`,
  )
}
await fs.writeFile(
  path.join(target, "regalia", "manifest.json"),
  JSON.stringify(
    entries.map(([id, { src, ...art }]) => ({ id, ...art })),
    null,
    2,
  ),
)
process.stdout.write(
  `Fixture: ${target}/index.html\nIndependent SVG assets: ${entries.length} in ${target}/regalia/\n`,
)
