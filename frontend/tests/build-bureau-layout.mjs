// Run from frontend after a production build. No external requests or login.
// Exports real UI fixtures and vendored Lucide SVGs, with their license.
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
    lib: { entry: "tests/guild-layout-entry.tsx", name: "BureauLayout", formats: ["iife"] },
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
css = css.replace(
  /url\((['"]?)(?:\/(?:static\/)?assets\/|\.\/)?([^)'"/]+)\1\)/g,
  (match, quote, name) => {
    if (!files.includes(name)) return match
    referenced.add(name)
    return `url("assets/${name}")`
  },
)
if (/url\(["']?\/(?:static\/)?assets\//.test(css))
  throw new Error("The offline preview still references a production asset URL")
if (![...referenced].some((name) => name.endsWith(".woff2")))
  throw new Error("The offline preview must include its fonts")
await fs.mkdir(path.join(target, "assets"), { recursive: true })
await Promise.all(
  [...referenced].map((name) =>
    fs.copyFile(path.join(assets, name), path.join(target, "assets", name)),
  ),
)
await fs.writeFile(path.join(target, "fixture.css"), css)
await fs.writeFile(
  path.join(target, "index.html"),
  '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR37 bureau QA</title><link rel="stylesheet" href="fixture.css"><body><a href="first-visit.html">Первый визит / First visit</a><div id="root"></div><script src="fixture.js"></script><script>BureauLayout.mount(document.getElementById("root"));</script></body></html>',
)

const briefing = await build({
  ...options,
  build: {
    write: false,
    minify: true,
    lib: { entry: "tests/bureau-layout-entry.tsx", name: "BriefingLayout", formats: ["iife"] },
  },
})
await fs.writeFile(
  path.join(target, "briefing.js"),
  briefing[0].output.find((item) => item.type === "chunk").code,
)
await fs.writeFile(
  path.join(target, "briefing.html"),
  '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR37 briefing QA</title><link rel="stylesheet" href="fixture.css"><body><a href="index.html">К бюро / Back to bureaus</a><div id="root"></div><script src="briefing.js"></script><script>BriefingLayout.mount(document.getElementById("root"));</script></body></html>',
)

const firstVisit = await build({
  ...options,
  build: {
    write: false,
    minify: true,
    lib: {
      entry: "tests/first-visit-layout-entry.tsx",
      name: "FirstVisitLayout",
      formats: ["iife"],
    },
  },
})
await fs.writeFile(
  path.join(target, "first-visit.js"),
  firstVisit[0].output.find((item) => item.type === "chunk").code,
)
await fs.writeFile(
  path.join(target, "first-visit.html"),
  '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>First visit QA</title><link rel="stylesheet" href="fixture.css"><body style="margin:0"><a href="index.html">К макету бюро / Back to bureau fixture</a><div id="root"></div><script src="first-visit.js"></script><script>FirstVisitLayout.mount(document.getElementById("root"));</script></body></html>',
)

// Stable reward identifiers are exported as native vectors, without any bitmap.
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
const iconSource = path.resolve("src/icons/lucide")
await fs.mkdir(path.join(target, "icons"), { recursive: true })
for (const name of await fs.readdir(iconSource)) {
  if (!name.endsWith(".svg")) continue
  await fs.copyFile(path.join(iconSource, name), path.join(target, "icons", name))
}
for (const [id, art] of entries) {
  const svg = await fs.readFile(path.join(iconSource, `${art.icon}.svg`), "utf8")
  if (/<image|<script|<foreignObject|href=|data:/i.test(svg))
    throw new Error(`Unexpected icon payload: ${id}`)
  await fs.writeFile(path.join(target, "regalia", `${id}.svg`), svg)
}
await fs.copyFile("public/licenses/lucide.txt", path.join(target, "LICENSE-lucide.txt"))
await fs.writeFile(
  path.join(target, "regalia", "manifest.json"),
  JSON.stringify(
    entries.map(([id, art]) => ({ id, ...art })),
    null,
    2,
  ),
)
process.stdout.write(
  `Fixture: ${target}/index.html\nNative SVG exports: ${entries.length} reward IDs; ${(await fs.readdir(iconSource)).length} Lucide icons.\n`,
)
