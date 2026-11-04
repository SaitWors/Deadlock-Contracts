import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { build } from "vite"
import { JSDOM } from "jsdom"

let code
let pages
const environments = []
before(async () => {
  pages = JSON.parse(await readFile("../shared/public-pages.json", "utf8"))
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    resolve: { alias: { "@": path.resolve("src") } },
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: "tests/seo-entry.tsx", name: "SEO", formats: ["iife"] },
    },
  })
  code = result[0].output.find((entry) => entry.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))

const guest = {
  authenticated: false,
  user: null,
  csrf_token: null,
  release: {
    version: "test",
    label: "test",
    post_match_only: true,
    modes: [],
    manual_verification: false,
  },
}
const signedIn = {
  ...guest,
  authenticated: true,
  csrf_token: "test-csrf",
  user: {
    id: "seo-player",
    display_name: "Known player",
    avatar_url: null,
    xp: 0,
    status: "ACTIVE",
    locale: "en",
    timezone: "UTC",
    access_role: "PLAYER",
    badges: ["PLAYER"],
    created_at: null,
    is_admin: false,
    is_staff: false,
    permissions: [],
    can_manage_roles: false,
  },
}

function runtime({
  url = "/",
  page = "home",
  language = "ru",
  session = () => Promise.resolve({ ok: true, json: async () => guest }),
  documents,
  reducedMotion = true,
} = {}) {
  const payload = JSON.stringify({ page, language, content: pages[page][language] }).replaceAll(
    "<",
    "\\u003c",
  )
  const dom = new JSDOM(
    `<html lang="${language}"><head><script id="dc-public-page" type="application/json">${payload}</script></head><body><div id="root"></div></body></html>`,
    { url: `https://qa.invalid${url}`, runScripts: "outside-only" },
  )
  environments.push(dom)
  const w = dom.window
  let expireSession
  const schedule = w.setTimeout.bind(w)
  w.setTimeout = (callback, delay, ...args) => {
    if (delay === 12_000) expireSession = callback
    return schedule(callback, delay, ...args)
  }
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.Headers = Headers
  w.AbortController = AbortController
  w.AbortSignal = AbortSignal
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.scrollTo = () => {}
  w.matchMedia = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} })
  w.HTMLMediaElement.prototype.play = () => Promise.resolve()
  w.HTMLMediaElement.prototype.pause = () => {}
  w.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  }
  w.localStorage.setItem("dc.ui.language", language === "en" ? "ru" : "en")
  const calls = []
  w.fetch = async (url, init) => {
    calls.push(String(url))
    if (url === "/api/me") return session(init)
    if (String(url).startsWith("/api/announcements/active"))
      return { ok: true, json: async () => ({ items: [], server_time: "2026-09-20T00:00:00Z" }) }
    if (documents) return documents(String(url), init)
    return { ok: false, status: 503, json: async () => ({ detail: "Unavailable in this fixture" }) }
  }
  w.eval(code)
  return { w, doc: w.document, api: w.SEO, calls, expireSession: () => expireSession() }
}

async function mount(options) {
  const env = runtime(options)
  await env.api.act(async () => {
    env.root = env.api.mount(env.doc.getElementById("root"))
  })
  return env
}
async function close(env) {
  await env.api.act(async () => env.root.unmount())
}

test("public homepage is readable while session discovery is pending", async () => {
  const env = await mount({ session: () => new Promise(() => {}) })
  assert.match(env.doc.querySelector("h1")?.textContent || "", /Deadlock/)
  assert.ok(env.doc.querySelector('a[href="/ru/contracts"]'))
  assert.equal(env.doc.documentElement.lang, "ru")
  assert.equal(env.calls.filter((url) => url === "/api/me").length, 1)
  await close(env)
})

test("session failure leaves public copy, retry recovers without hiding it", async () => {
  let attempts = 0
  const env = await mount({
    session: async () =>
      ++attempts === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => guest },
  })
  assert.match(env.doc.querySelector("h1")?.textContent || "", /Deadlock/)
  assert.ok(env.doc.querySelector('[role="alert"]'))
  const retry = [...env.doc.querySelectorAll("button")].find((button) =>
    /ПОВТОРИТЬ|TRY AGAIN/.test(button.textContent),
  )
  assert.ok(retry)
  await env.api.act(async () => retry.click())
  assert.equal(attempts, 2)
  assert.equal(env.doc.querySelector('[role="alert"]'), null)
  assert.match(env.doc.querySelector("h1").textContent, /Deadlock/)
  await close(env)
})

for (const language of ["ru", "en"]) {
  test(`explicit ${language} cards page overrides preferences and remains public with a session`, async () => {
    const env = await mount({
      url: `/${language}/cards`,
      page: "cards",
      language,
      session: async () => ({ ok: true, json: async () => signedIn }),
    })
    assert.equal(env.doc.documentElement.lang, language)
    assert.equal(env.doc.querySelector("h1").textContent, pages.cards[language].heading)
    assert.ok(env.doc.body.textContent.includes(pages.cards[language].sections[0].text))
    assert.ok(env.doc.querySelector(`a[href="/${language}/cards"][aria-current="page"]`))
    assert.ok(env.doc.querySelector('a[href="/en/cards"][hreflang="en"]'))
    assert.ok(env.doc.querySelector('a[href="/ru/cards"][hreflang="ru"]'))
    assert.equal(env.calls.includes("/api/me"), false)
    assert.equal(env.doc.body.textContent.includes("Known player"), false)
    await close(env)
  })
}

test("unknown frontend path shows a not-found page and never requests a session", async () => {
  const env = await mount({ url: "/not-a-real-page" })
  assert.match(env.doc.querySelector("h1")?.textContent || "", /404/)
  assert.equal(env.calls.includes("/api/me"), false)
  await close(env)
})

test("public mobile navigation exposes real document links", async () => {
  const env = await mount({ url: "/en/about", page: "about", language: "en" })
  const toggle = env.doc.querySelector(".bureau-menu-toggle")
  await env.api.act(async () => toggle.click())
  assert.ok(env.doc.querySelector('.bureau-mobile-nav a[href="/en/how-it-works"]'))
  assert.ok(env.doc.querySelector('.bureau-mobile-nav a[href="/en/cards"]'))
  assert.equal(env.doc.querySelector(".bureau-mobile-nav button[aria-current]"), null)
  await close(env)
})

test("authenticated root keeps the dashboard and its existing leaderboard hash", async () => {
  const env = await mount({
    url: "/#leaderboards",
    session: async () => ({ ok: true, json: async () => signedIn }),
  })
  assert.ok(env.doc.querySelector(".dc-dashboard"))
  assert.equal(env.w.location.hash, "#leaderboards")
  assert.ok(env.doc.querySelector('.bureau-nav button[aria-current="page"]'))
  assert.equal(env.doc.querySelector(".dc-language-switch a"), null)
  await close(env)
})

test("existing administrative review URL still checks the session", async () => {
  const env = await mount({ url: "/admin/reviews" })
  assert.equal(env.calls.includes("/api/me"), true)
  assert.doesNotMatch(env.doc.querySelector("h1")?.textContent || "", /404/)
  await close(env)
})

test("a timed-out session still leaves the public page and retry available", async () => {
  const env = await mount({
    session: ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Timed out", "AbortError")),
          { once: true },
        )
      }),
  })
  await env.api.act(async () => env.expireSession())
  assert.match(env.doc.querySelector("h1").textContent, /Deadlock/)
  assert.ok(env.doc.querySelector('[role="alert"] button'))
  await close(env)
})

test("legacy public links resolve to documents while private hashes are untouched", () => {
  const { api } = runtime()
  assert.equal(api.legacyPublicUrl("#contracts", "ru"), "/ru/contracts")
  assert.equal(api.legacyPublicUrl("#how", "en"), "/en/how-it-works")
  assert.equal(api.legacyPublicUrl("#leaderboards", "en"), "/en/leaderboard")
  for (const hash of ["#archive", "#bureaus/night-shift", "#profile", "#admin", "#unknown"])
    assert.equal(api.legacyPublicUrl(hash, "ru"), null)
})

test("Ritual public home offers match contracts and a free daily pack without retired economy", async () => {
  const env = await mount({ url: "/ru/", page: "home", language: "ru" })
  assert.match(env.doc.querySelector("h1")?.textContent || "", /Твой матч/i)
  assert.match(env.doc.body.textContent, /Ежедневный пак/)
  assert.doesNotMatch(
    env.doc.body.textContent,
    /CITY NEVER SLEEPS|монет|жетон|шифр|Арена Бюро|каталог/i,
  )
  assert.equal(
    env.doc.querySelector('video[src*="scroll-seal"]'),
    null,
    "signing media must not load on the public homepage",
  )
  await close(env)
})

test("public contract preview caps selection at three and never creates a real case", async () => {
  const env = await mount({ url: "/en/contracts", page: "contracts", language: "en" })
  const choices = [...env.doc.querySelectorAll("button[data-contract-choice]")]
  assert.equal(choices.length, 6)
  for (const choice of choices.slice(0, 4)) {
    await env.api.act(async () => choice.click())
  }
  assert.equal(env.doc.querySelectorAll('[data-contract-choice][aria-pressed="true"]').length, 3)
  assert.equal(choices[3].disabled, true)
  assert.ok(env.doc.body.textContent.includes("Demo board"))
  assert.equal(
    env.calls.some((url) => /boards.*lock/.test(url)),
    false,
  )
  await close(env)
})

function publicDocument(url) {
  const pathname = new URL(url).pathname
  const language = pathname.split("/")[1]
  const page = Object.keys(pages).find((key) => pages[key].slug === pathname.split("/")[2])
  assert.ok(page, `Unknown public fixture: ${pathname}`)
  const content = pages[page][language]
  return {
    ok: true,
    url,
    text: async () => `<html lang="${language}"><head><title>${content.title}</title>
      <meta name="description" content="${content.description}">
      <link rel="canonical" href="https://qa.invalid${pathname}">
      <script id="dc-public-page" type="application/json">${JSON.stringify({ page, language, content }).replaceAll("<", "\\u003c")}</script>
      </head><body></body></html>`,
  }
}

test("guest root navigation keeps the actual header and animated background mounted", async () => {
  const env = await mount({ documents: publicDocument, reducedMotion: false })
  const header = env.doc.querySelector(".bureau-header")
  const background = env.doc.querySelector(".bureau-atmosphere video")
  assert.ok(header)
  assert.ok(background)
  const sessionCalls = env.calls.filter((url) => url === "/api/me").length
  await env.api.act(async () =>
    env.doc.querySelector('.bureau-nav a[href="/ru/contracts"]').click(),
  )
  assert.equal(env.w.location.pathname, "/ru/contracts")
  assert.equal(env.doc.querySelector(".bureau-header"), header)
  assert.equal(env.doc.querySelector(".bureau-atmosphere video"), background)
  assert.equal(env.doc.querySelectorAll("[data-contract-choice]").length, 6)
  assert.ok(env.doc.querySelector('.bureau-nav a[href="/ru/contracts"][aria-current="page"]'))
  assert.equal(env.calls.filter((url) => url === "/api/me").length, sessionCalls)
  await close(env)
})

test("localized App navigation updates page copy and locale while preserving the public shell", async () => {
  const env = await mount({
    url: "/ru/about",
    page: "about",
    language: "ru",
    documents: publicDocument,
    reducedMotion: false,
    session: async () => ({ ok: true, json: async () => signedIn }),
  })
  const header = env.doc.querySelector(".bureau-header")
  const background = env.doc.querySelector(".bureau-atmosphere video")
  await env.api.act(async () => env.doc.querySelector('.bureau-nav a[href="/ru/cards"]').click())
  await env.api.act(async () => env.doc.querySelector('.bureau-account a[hreflang="en"]').click())
  assert.equal(env.w.location.pathname, "/en/cards")
  assert.equal(env.doc.documentElement.lang, "en")
  assert.equal(env.doc.querySelector("h1").textContent, pages.cards.en.heading)
  assert.ok(env.doc.body.textContent.includes(pages.cards.en.sections[0].text))
  assert.equal(env.doc.title, pages.cards.en.title)
  assert.equal(env.doc.querySelector('link[rel="canonical"]').href, "https://qa.invalid/en/cards")
  assert.equal(env.doc.querySelector(".bureau-header"), header)
  assert.equal(env.doc.querySelector(".bureau-atmosphere video"), background)
  assert.equal(env.doc.querySelector(".dc-dashboard"), null)
  assert.equal(env.calls.includes("/api/me"), false)
  await close(env)
})

test("delayed Back and Forward retain committed public copy and scenery until the destination is ready", async () => {
  let deferDocuments = false
  const pendingDocuments = []
  const env = await mount({
    url: "/ru/about",
    page: "about",
    language: "ru",
    reducedMotion: false,
    documents: (url) =>
      deferDocuments
        ? new Promise((resolve) => pendingDocuments.push({ url, resolve }))
        : publicDocument(url),
  })
  try {
    const header = env.doc.querySelector(".bureau-header")
    const background = env.doc.querySelector(".bureau-atmosphere video")
    await env.api.act(async () => env.doc.querySelector('.bureau-nav a[href="/ru/cards"]').click())
    assert.equal(env.doc.querySelector("h1")?.textContent, pages.cards.ru.heading)
    deferDocuments = true

    for (const [direction, previousPage, destinationPage] of [
      ["back", "cards", "about"],
      ["forward", "about", "cards"],
    ]) {
      await env.api.act(async () => {
        const popped = new Promise((resolve) =>
          env.w.addEventListener("popstate", resolve, { once: true }),
        )
        env.w.history[direction]()
        await popped
      })
      assert.equal(env.w.location.pathname, `/ru/${pages[destinationPage].slug}`)
      assert.equal(env.doc.querySelector("h1")?.textContent, pages[previousPage].ru.heading)
      assert.ok(env.doc.body.textContent.includes(pages[previousPage].ru.sections[0].text))
      assert.equal(env.doc.querySelector(".bureau-header"), header)
      assert.equal(env.doc.querySelector(".bureau-atmosphere video"), background)
      const request = pendingDocuments.shift()
      assert.ok(request, "history traversal should load its public document")
      await env.api.act(async () => request.resolve(publicDocument(request.url)))
      assert.equal(env.doc.querySelector("h1")?.textContent, pages[destinationPage].ru.heading)
      assert.ok(env.doc.body.textContent.includes(pages[destinationPage].ru.sections[0].text))
      assert.equal(env.doc.querySelector(".bureau-header"), header)
      assert.equal(env.doc.querySelector(".bureau-atmosphere video"), background)
    }
  } finally {
    await close(env)
  }
})

test("mobile language navigation closes the menu when the public page keeps its identity", async () => {
  const env = await mount({
    url: "/ru/about",
    page: "about",
    language: "ru",
    documents: publicDocument,
  })
  try {
    await env.api.act(async () => env.doc.querySelector(".bureau-menu-toggle").click())
    assert.equal(env.doc.querySelector(".bureau-menu-toggle").getAttribute("aria-expanded"), "true")
    await env.api.act(async () =>
      env.doc.querySelector('.bureau-mobile-nav a[hreflang="en"]').click(),
    )
    assert.equal(env.w.location.pathname, "/en/about")
    assert.equal(
      env.doc.querySelector(".bureau-menu-toggle").getAttribute("aria-expanded"),
      "false",
    )
    assert.equal(env.doc.querySelector(".bureau-mobile-nav"), null)
  } finally {
    await close(env)
  }
})
