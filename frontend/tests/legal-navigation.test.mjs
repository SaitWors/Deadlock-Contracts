import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { JSDOM } from "jsdom"

const script = readFileSync("../app/static/legal.js", "utf8")
for (const language of ["ru", "en"]) {
  test(`${language} document language switch preserves every public document route`, async () => {
    const html = readFileSync(`../app/static/legal${language === "en" ? "_en" : ""}.html`, "utf8")
    for (const route of ["privacy", "terms", "support", "status", "changelog", "data-sources"]) {
      const dom = new JSDOM(html, {
        url: `https://qa.invalid/${language}/${route}`,
        runScripts: "outside-only",
      })
      try {
        dom.window.fetch = async () => ({ ok: false })
        dom.window.eval(script)
        const other = language === "ru" ? "en" : "ru"
        assert.equal(
          dom.window.document.querySelector("[data-document-language]").getAttribute("href"),
          `/${other}/${route}`,
        )
        await new Promise((resolve) => setImmediate(resolve))
      } finally {
        dom.window.close()
      }
    }
  })
}
