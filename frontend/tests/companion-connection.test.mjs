import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { JSDOM } from "jsdom"

const html = readFileSync(new URL("../../app/static/pair.html", import.meta.url), "utf8")
const script = readFileSync(new URL("../../app/static/pair.js", import.meta.url), "utf8")
const challenge = `${Math.floor(Date.now() / 1000) + 600}.${"a".repeat(64)}.${"b".repeat(64)}`
const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

function browser(url, handle, { savedLanguage, savedChallenge } = {}) {
  const dom = new JSDOM(html, {
    url: `https://example.test${url}`,
    runScripts: "outside-only",
  })
  const { window } = dom
  if (savedLanguage) window.localStorage.setItem("dc.ui.language", savedLanguage)
  if (savedChallenge) window.sessionStorage.setItem("companion-link-challenge", savedChallenge)
  window.fetch = handle
  window.eval(script)
  return {
    window,
    element: (id) => window.document.getElementById(id),
  }
}

test("pairing page defaults to English and remembers a website language change", () => {
  const { window, element } = browser("/pair", () => assert.fail("Unnecessary session lookup"))
  try {
    assert.equal(window.document.documentElement.lang, "en")
    assert.match(element("status").textContent, /Choose Connect in browser/)
    element("language").value = "ru"
    element("language").dispatchEvent(new window.Event("change"))
    assert.equal(window.document.documentElement.lang, "ru")
    assert.match(element("status").textContent, /Подключить через браузер/)
    assert.equal(window.localStorage.getItem("dc.ui.language"), "ru")
  } finally {
    window.close()
  }
})

test("the Russian request survives Steam return and only sends approval on a click", async () => {
  const calls = []
  const session = {
    authenticated: true,
    user: { display_name: "QA player" },
    csrf_token: "test-csrf",
  }
  const returnPage = browser(
    "/pair?login=ok",
    async (path, options) => {
      calls.push({ path, options })
      return {
        ok: true,
        json: async () => (path === "/api/me" ? session : { approved: true }),
      }
    },
    { savedChallenge: challenge, savedLanguage: "ru" },
  )
  const { window, element } = returnPage
  try {
    await nextTurn()
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/api/me"],
    )
    assert.equal(element("approval").hidden, false)
    assert.match(element("status").textContent, /QA player.*BBBBBB/)
    element("approve").click()
    await nextTurn()
    assert.equal(calls[1].options.headers["X-CSRF-Token"], "test-csrf")
    assert.equal(calls[1].options.headers["Accept-Language"], "ru")
    assert.match(element("status").textContent, /Подключение подтверждено/)
    assert.equal(window.sessionStorage.getItem("companion-link-challenge"), null)
  } finally {
    window.close()
  }
})

test("opening a browser link strips its fragment and localizes Steam errors", async () => {
  const { window, element } = browser(
    `/pair?lang=ru&auth_error=closed_alpha#${challenge}`,
    async () => ({ ok: true, json: async () => ({ authenticated: false }) }),
  )
  try {
    await nextTurn()
    assert.equal(window.location.hash, "")
    assert.equal(new URL(window.location.href).searchParams.has("lang"), false)
    assert.match(element("status").textContent, /нет доступа/)
    assert.equal(element("sign-in").hidden, false)
    assert.equal(element("sign-in-link").textContent, "Войти через Steam")
    assert.equal(window.sessionStorage.getItem("companion-link-language"), "ru")
  } finally {
    window.close()
  }
})
