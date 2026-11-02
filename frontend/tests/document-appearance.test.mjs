import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { JSDOM } from "jsdom"
import vm from "node:vm"
import ts from "typescript"

const script = await readFile("../app/static/document-appearance.js", "utf8")
const luminosity = (hex) =>
  [...hex.slice(1).matchAll(/../g)]
    .map(([n]) => parseInt(n, 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) =>
  (Math.max(luminosity(a), luminosity(b)) + 0.05) / (Math.min(luminosity(a), luminosity(b)) + 0.05)

function render(preference = {}) {
  const dom = new JSDOM(
    '<html><head><meta name="theme-color"></head><body><select data-document-theme><option>dark</option><option>custom</option><option>system</option><option>light</option><option>black</option></select></body></html>',
    { url: "https://qa.invalid/en/privacy", runScripts: "outside-only" },
  )
  const media = { matches: false, addEventListener() {} }
  dom.window.matchMedia = () => media
  dom.window.localStorage.setItem("dc.ui.appearance", JSON.stringify(preference))
  dom.window.eval(script)
  return { dom, doc: dom.window.document, media }
}

test("standalone custom appearance keeps saved choices and is readable on its elevated paper", () => {
  for (const accent of [
    "#785d83",
    "#000000",
    "#ffffff",
    "#c47373",
    "#797979",
    "#808080",
    "#858585",
  ]) {
    const { dom, doc } = render({ theme: "custom", accent, radius: 26, motion: false })
    const style = doc.documentElement.style
    assert.equal(style.getPropertyValue("--ns-radius"), "8px")
    assert.equal(style.getPropertyValue("--ns-fill"), accent)
    assert.equal(doc.documentElement.dataset.motion, "reduced")
    assert.ok(
      contrast(style.getPropertyValue("--ns-accent"), "#202821") >= 4.5,
      "accent is readable on the actual custom elevated surface",
    )
    assert.ok(
      contrast(style.getPropertyValue("--ns-on-accent"), accent) >= 4.5,
      "button label is readable on the saved fill",
    )
    dom.window.close()
  }
})

test("web custom appearance keeps mid-tone saved fills readable", async () => {
  const source = await readFile("src/appearance-state.ts", "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  for (const accent of ["#797979", "#808080", "#858585", "#866080", "#af6f00"]) {
    const { dom, doc } = render()
    const exports = {}
    vm.runInNewContext(compiled, { exports, window: dom.window, document: doc })
    exports.applyAppearance({ theme: "custom", accent, radius: 24, motion: false })
    const style = doc.documentElement.style
    assert.equal(style.getPropertyValue("--ns-fill"), accent)
    assert.ok(
      contrast(style.getPropertyValue("--ns-on-accent"), accent) >= 4.5,
      `button text on saved ${accent}`,
    )
    assert.ok(
      contrast(style.getPropertyValue("--ns-accent"), "#202821") >= 4.5,
      `link on saved ${accent}`,
    )
    dom.window.close()
  }
})

test("standalone theme switches preserve manual preferences and update Ritual browser color", () => {
  const { dom, doc } = render({ theme: "custom", accent: "#785d83", radius: 24, motion: false })
  const select = doc.querySelector("select")
  for (const [theme, color] of Object.entries({
    dark: "#0b0d0d",
    light: "#eeeee7",
    black: "#000000",
    custom: "#0b100d",
    system: "#eeeee7",
  })) {
    select.value = theme
    select.dispatchEvent(new dom.window.Event("change"))
    assert.equal(doc.querySelector("meta").content, color)
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("dc.ui.appearance")), {
      theme,
      accent: "#785d83",
      radius: 8,
      motion: false,
    })
  }
  dom.window.close()
})
