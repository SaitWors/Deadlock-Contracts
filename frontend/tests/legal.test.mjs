import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { setImmediate } from "node:timers/promises"
import { JSDOM } from "jsdom"

for (const language of ["ru", "en"]) {
  test(`legal enhancements preserve server metadata and work with one ${language} article`, async () => {
    const source = await readFile(
      `../app/static/legal${language === "en" ? "_en" : ""}.html`,
      "utf8",
    )
    const script = await readFile("../app/static/legal.js", "utf8")
    for (const [slug, id] of [
      ["privacy", "privacyDocument"],
      ["terms", "termsDocument"],
      ["support", "supportDocument"],
      ["status", "statusDocument"],
      ["changelog", "changelogDocument"],
      ["data-sources", "dataSourcesDocument"],
    ]) {
      const dom = new JSDOM(source, {
        url: `https://qa.invalid/${language}/${slug}`,
        runScripts: "outside-only",
      })
      try {
        const { document } = dom.window
        // The server sends only the selected article and its descriptive metadata.
        document.querySelectorAll("article").forEach((article) => {
          if (article.id !== id) article.remove()
          else article.classList.remove("hidden")
        })
        const title = `${document.querySelector("h1").textContent} | Deadlock Contracts`
        document.title = title
        dom.window.fetch = async () => ({
          ok: true,
          json: async () => ({
            contact_email: "support@example.invalid",
            components: { database: "ready" },
            version: "test",
          }),
        })
        dom.window.eval(script)
        await setImmediate()
        assert.equal(document.title, title)
        assert.equal(document.querySelectorAll("article").length, 1)
        assert.equal(document.getElementById(id).classList.contains("hidden"), false)
        document.querySelectorAll(".legalContact").forEach((contact) => {
          assert.equal(contact.textContent, "support@example.invalid")
        })
        if (slug === "status")
          assert.match(document.getElementById("publicStatus").textContent, /ready/)
      } finally {
        dom.window.close()
      }
    }
  })
}
