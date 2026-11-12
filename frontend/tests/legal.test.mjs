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
        const requests = []
        dom.window.fetch = async (url) => {
          requests.push(url)
          return {
            ok: slug === "status",
            json: async () => ({
              components: { database: "ready" },
              version: "test",
            }),
          }
        }
        dom.window.eval(script)
        await setImmediate()
        assert.equal(document.title, title)
        assert.equal(document.querySelectorAll("article").length, 1)
        assert.equal(document.getElementById(id).classList.contains("hidden"), false)
        assert.deepEqual(requests, slug === "status" ? ["/api/status"] : [])
        if (["privacy", "terms", "support"].includes(slug)) {
          const contact = document.querySelector('a[href="https://t.me/deadlockts_bot"]')
          assert.equal(contact?.textContent, "@deadlockts_bot")
        }
        if (slug === "status")
          assert.match(
            document.getElementById("publicStatus").textContent,
            language === "ru" ? /Готово/ : /Ready/,
          )
      } finally {
        dom.window.close()
      }
    }
  })
}

for (const language of ["ru", "en"]) {
  test(`status distinguishes configuration from availability and recovers in ${language}`, async () => {
    const source = await readFile(
      `../app/static/legal${language === "en" ? "_en" : ""}.html`,
      "utf8",
    )
    const script = await readFile("../app/static/legal.js", "utf8")
    const dom = new JSDOM(source, {
      url: `https://qa.invalid/${language}/status`,
      runScripts: "outside-only",
    })
    try {
      const { document } = dom.window
      let calls = 0
      dom.window.fetch = async (_url, options) => {
        calls += 1
        assert.equal(options.cache, "no-store")
        assert.ok(options.signal)
        if (calls === 1) throw new Error("offline")
        return {
          ok: true,
          json: async () => ({
            components: {
              match_provider: "configured",
              reward_delivery: "paused",
              database: "unexpected_state",
            },
            updated_at: "not a date",
            version: "test",
            incident_history: [],
          }),
        }
      }
      dom.window.eval(script)
      await setImmediate()
      const status = document.getElementById("publicStatus")
      const button = document.getElementById("refreshStatus")
      assert.match(status.textContent, language === "ru" ? /Не удалось/ : /Could not retrieve/)
      assert.equal(button.hidden, false)
      assert.equal(button.getAttribute("aria-disabled"), "false")
      button.focus()
      button.click()
      assert.equal(button.getAttribute("aria-disabled"), "true")
      button.click()
      assert.equal(status.getAttribute("aria-busy"), "true")
      await setImmediate()
      assert.equal(calls, 2)
      assert.equal(document.activeElement, button)
      assert.equal(status.getAttribute("aria-busy"), "false")
      assert.match(
        status.textContent,
        language === "ru" ? /Подключение настроено/ : /Connection configured/,
      )
      assert.match(status.textContent, language === "ru" ? /Приостановлено/ : /Paused/)
      assert.match(status.textContent, language === "ru" ? /Нет сведений/ : /No information/)
      assert.doesNotMatch(status.textContent, /unexpected_state|Invalid Date|operational/)
      assert.equal(document.querySelector("#statusDocument .legal-updated"), null)
      assert.match(
        document.querySelector(".public-status-note").textContent,
        language === "ru" ? /не независимая/ : /not an independent/,
      )
    } finally {
      dom.window.close()
    }
  })
}

test("status timeout releases the retry button instead of leaving a permanent loading state", async () => {
  const dom = new JSDOM(
    '<html lang="en"><div id="publicStatus"></div><button id="refreshStatus" hidden>Retry</button></html>',
    {
      url: "https://qa.invalid/en/status",
      runScripts: "outside-only",
    },
  )
  try {
    const script = await readFile("../app/static/legal.js", "utf8")
    let expire
    dom.window.setTimeout = (callback) => {
      expire = callback
      return 1
    }
    dom.window.clearTimeout = () => {}
    dom.window.fetch = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timeout")))
      })
    dom.window.eval(script)
    expire()
    await setImmediate()
    assert.equal(
      dom.window.document.getElementById("refreshStatus").getAttribute("aria-disabled"),
      "false",
    )
    assert.match(
      dom.window.document.getElementById("publicStatus").textContent,
      /Could not retrieve/,
    )
  } finally {
    dom.window.close()
  }
})
