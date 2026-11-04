import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { build } from "vite"
import { JSDOM, VirtualConsole } from "jsdom"

let code
const environments = []
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: "tests/public-navigation-entry.tsx",
        name: "PublicNavigationTest",
        formats: ["iife"],
      },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))

function html(pathname, { invalid = false } = {}) {
  const language = pathname.startsWith("/en/") ? "en" : "ru"
  const slug = pathname.split("/")[2]
  const page = slug || "home"
  const title = `${language} ${page}`
  const content = {
    heading: title,
    intro: `${title} intro`,
    sections: [{ heading: "Details", text: title }],
  }
  const payload = JSON.stringify({ page, language, content: invalid ? null : content })
  return `<!doctype html><html lang="${language}"><head>
    <title>${title}</title>
    <meta name="description" content="${title} description">
    <meta name="robots" content="index, follow">
    <meta property="og:title" content="${title}">
    <meta property="og:url" content="https://qa.invalid${pathname}">
    <meta property="og:locale" content="${language === "ru" ? "ru_RU" : "en_US"}">
    <meta name="twitter:title" content="${title}">
    <link rel="canonical" href="https://qa.invalid${pathname}">
    <link rel="alternate" hreflang="ru" href="https://qa.invalid/ru/${slug}">
    <link rel="alternate" hreflang="en" href="https://qa.invalid/en/${slug}">
    <script type="application/ld+json">${JSON.stringify({ url: `https://qa.invalid${pathname}` })}</script>
    <script id="dc-public-page" type="application/json">${payload}</script>
    </head><body><div id="root"></div></body></html>`
}

async function mount({ enabled = true, url = "/ru/about" } = {}) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error) => errors.push(error))
  const dom = new JSDOM(html(new URL(url, "https://qa.invalid").pathname), {
    url: `https://qa.invalid${url}`,
    runScripts: "outside-only",
    virtualConsole,
  })
  environments.push(dom)
  const w = dom.window
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.Headers = Headers
  w.AbortController = AbortController
  const scrolls = []
  const fragments = []
  const focuses = []
  w.scrollTo = (options) => scrolls.push(options)
  w.HTMLElement.prototype.scrollIntoView = function (options) {
    fragments.push({ element: this, options })
  }
  const nativeFocus = w.HTMLElement.prototype.focus
  w.HTMLElement.prototype.focus = function (options) {
    focuses.push({ element: this, options })
    nativeFocus.call(this, options)
  }
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  const requests = []
  w.fetch = (url, init) =>
    new Promise((resolve, reject) => requests.push({ url: String(url), init, resolve, reject }))
  w.eval(code)
  const env = {
    w,
    doc: w.document,
    api: w.PublicNavigationTest,
    requests,
    errors,
    scrolls,
    fragments,
    focuses,
  }
  await env.api.act(async () => {
    env.root = env.api.mount(env.doc.getElementById("root"), enabled)
  })
  return env
}

async function click(env, href, options = {}) {
  let anchor = [...env.doc.querySelectorAll("a")].find((item) => item.getAttribute("href") === href)
  if (!anchor) {
    anchor = env.doc.createElement("a")
    anchor.href = href
    env.doc.body.append(anchor)
  }
  if (options.target) anchor.target = options.target
  if (options.download) anchor.download = "copy.html"
  const event = new env.w.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...options,
  })
  await env.api.act(async () => anchor.dispatchEvent(event))
  return { anchor, event }
}

async function respond(env, request, pathname, options) {
  await env.api.act(async () => {
    request.resolve({
      ok: true,
      status: 200,
      url: `https://qa.invalid${pathname}`,
      text: async () => html(pathname, options),
    })
  })
}

async function close(env) {
  await env.api.act(async () => env.root.unmount())
}

test("public navigation keeps the shell and old page while loading, then commits content and metadata together", async () => {
  const env = await mount()
  const header = env.doc.querySelector("header")
  const video = env.doc.querySelector("video")
  const historyLength = env.w.history.length
  const { event } = await click(env, "/ru/contracts")
  assert.equal(event.defaultPrevented, true)
  assert.equal(env.requests.length, 1)
  assert.equal(new URL(env.requests[0].url, env.w.location.href).pathname, "/ru/contracts")
  assert.equal(env.doc.querySelector("[data-pending]").textContent, "true")
  assert.equal(env.doc.querySelector("h1").textContent, "ru about")
  assert.equal(env.doc.title, "ru about")
  assert.equal(env.w.location.pathname, "/ru/about")
  await respond(env, env.requests[0], "/ru/contracts")
  assert.equal(env.doc.querySelector("[data-pending]").textContent, "false")
  assert.equal(env.doc.querySelector("[data-pathname]").textContent, "/ru/contracts")
  assert.equal(env.doc.querySelector("h1").textContent, "ru contracts")
  assert.equal(env.doc.title, "ru contracts")
  assert.equal(
    env.doc.querySelector('meta[name="description"]').content,
    "ru contracts description",
  )
  assert.equal(env.doc.querySelector('meta[property="og:title"]').content, "ru contracts")
  assert.equal(env.doc.querySelector('meta[name="twitter:title"]').content, "ru contracts")
  assert.equal(
    env.doc.querySelector('link[rel="canonical"]').href,
    "https://qa.invalid/ru/contracts",
  )
  assert.equal(env.doc.querySelector('link[hreflang="en"]').href, "https://qa.invalid/en/contracts")
  assert.deepEqual(
    JSON.parse(env.doc.querySelector('script[type="application/ld+json"]').textContent),
    { url: "https://qa.invalid/ru/contracts" },
  )
  assert.equal(env.w.history.length, historyLength + 1)
  assert.equal(env.doc.querySelector("header"), header)
  assert.equal(env.doc.querySelector("video"), video)
  await close(env)
})

test("latest navigation wins when an earlier document finishes after a newer one", async () => {
  const env = await mount()
  await click(env, "/ru/contracts")
  await click(env, "/en/about")
  assert.equal(env.requests.length, 2)
  await respond(env, env.requests[1], "/en/about")
  await respond(env, env.requests[0], "/ru/contracts")
  assert.equal(env.w.location.pathname, "/en/about")
  assert.equal(env.doc.querySelector("h1").textContent, "en about")
  assert.equal(env.doc.documentElement.lang, "en")
  assert.equal(env.doc.querySelector('meta[property="og:locale"]').content, "en_US")
  assert.equal(env.doc.querySelector("[data-pending]").textContent, "false")
  await close(env)
})

test("selecting the current page cancels an in-flight destination", async () => {
  const env = await mount()
  await click(env, "/ru/contracts")
  await click(env, "/ru/about")
  assert.equal(env.requests[0].init.signal.aborted, true)
  assert.equal(env.doc.querySelector("[data-pending]").textContent, "false")
  await respond(env, env.requests[0], "/ru/contracts")
  assert.equal(env.w.location.pathname, "/ru/about")
  assert.equal(env.doc.querySelector("h1").textContent, "ru about")
  await close(env)
})

test("same-page home links remove the fragment and repeated links return to the top without fetching", async () => {
  const env = await mount({ url: "/ru/#contract-board" })
  const historyLength = env.w.history.length
  await click(env, "/ru/")
  assert.equal(env.w.location.href, "https://qa.invalid/ru/")
  assert.equal(env.w.history.length, historyLength + 1)
  assert.equal(env.scrolls.at(-1)?.top, 0)
  assert.equal(env.doc.activeElement, env.doc.querySelector("h1"))
  const scrollCount = env.scrolls.length
  await click(env, "/ru/")
  assert.equal(env.scrolls.length, scrollCount + 1)
  assert.equal(env.w.history.length, historyLength + 1)
  assert.equal(env.requests.length, 0)
  await close(env)
})

test("canceling a pending Back navigation to the visible page reconciles the address", async () => {
  const env = await mount()
  await click(env, "/ru/contracts")
  await respond(env, env.requests[0], "/ru/contracts")
  await env.api.act(async () => {
    const popped = new Promise((resolve) =>
      env.w.addEventListener("popstate", resolve, { once: true }),
    )
    env.w.history.back()
    await popped
  })
  assert.equal(env.w.location.pathname, "/ru/about")
  assert.equal(env.doc.querySelector("h1").textContent, "ru contracts")
  await click(env, "/ru/contracts")
  assert.equal(env.requests[1].init.signal.aborted, true)
  assert.equal(env.w.location.pathname, "/ru/contracts")
  assert.equal(env.doc.querySelector("h1").textContent, "ru contracts")
  assert.equal(env.doc.querySelector("[data-pending]").textContent, "false")
  await respond(env, env.requests[1], "/ru/about")
  assert.equal(env.w.location.pathname, "/ru/contracts")
  assert.equal(env.doc.querySelector("h1").textContent, "ru contracts")
  await close(env)
})

test("committed pages receive focus without overriding a destination fragment", async () => {
  const env = await mount()
  const link = env.doc.querySelector('a[href="/ru/contracts"]')
  link.focus()
  await click(env, "/ru/contracts#details")
  await respond(env, env.requests[0], "/ru/contracts")
  const heading = env.doc.querySelector("h1")
  assert.equal(env.doc.activeElement, heading)
  assert.equal(heading.getAttribute("tabindex"), "-1")
  assert.equal(env.focuses.at(-1)?.options.preventScroll, true)
  assert.equal(env.fragments.at(-1)?.element.id, "details")
  assert.equal(env.scrolls.length, 0)
  await close(env)
})

test("native same-page fragments and their history do not fetch or override browser scroll restoration", async () => {
  const env = await mount()
  await env.api.act(async () => {
    const changed = new Promise((resolve) =>
      env.w.addEventListener("hashchange", resolve, { once: true }),
    )
    const { event } = await click(env, "#details")
    assert.equal(event.defaultPrevented, false)
    await changed
  })
  for (const [direction, hash] of [
    ["back", ""],
    ["forward", "#details"],
  ]) {
    await env.api.act(async () => {
      const popped = new Promise((resolve) =>
        env.w.addEventListener("popstate", resolve, { once: true }),
      )
      env.w.history[direction]()
      await popped
    })
    assert.equal(env.w.location.hash, hash)
  }
  assert.equal(env.requests.length, 0)
  assert.equal(env.scrolls.length, 0)
  assert.equal(env.fragments.length, 0)
  await close(env)
})

test("Back and Forward restore public documents without adding history entries or replacing the shell", async () => {
  const env = await mount()
  const video = env.doc.querySelector("video")
  await click(env, "/ru/contracts")
  await respond(env, env.requests[0], "/ru/contracts")
  const historyLength = env.w.history.length
  for (const [direction, pathname] of [
    ["back", "/ru/about"],
    ["forward", "/ru/contracts"],
  ]) {
    await env.api.act(async () => {
      const popped = new Promise((resolve) =>
        env.w.addEventListener("popstate", resolve, { once: true }),
      )
      env.w.history[direction]()
      await popped
    })
    const request = env.requests.at(-1)
    assert.equal(new URL(request.url, env.w.location.href).pathname, pathname)
    await respond(env, request, pathname)
    assert.equal(env.doc.querySelector("[data-pathname]").textContent, pathname)
    assert.equal(env.w.history.length, historyLength)
    assert.equal(env.doc.querySelector("video"), video)
  }
  await close(env)
})

test("modified, targeted, downloaded, external and non-public links keep browser navigation", async () => {
  const env = await mount()
  const intercepted = []
  const preventBrowserNavigation = (event) => {
    intercepted.push(event.defaultPrevented)
    event.preventDefault()
  }
  env.doc.addEventListener("click", preventBrowserNavigation)
  for (const [href, options] of [
    ["/ru/contracts", { ctrlKey: true }],
    ["/ru/contracts", { metaKey: true }],
    ["/ru/cards", { target: "_blank" }],
    ["/en/about", { download: true }],
    ["https://external.invalid/ru/contracts", {}],
    ["/auth/steam", {}],
    ["/admin/reviews", {}],
    ["/support", {}],
    ["/ru/terms", {}],
    ["#details", {}],
  ])
    await click(env, href, options)
  assert.equal(env.requests.length, 0)
  assert.deepEqual(intercepted, Array(intercepted.length).fill(false))
  env.doc.removeEventListener("click", preventBrowserNavigation)
  await close(env)
})

test("disabled public navigation leaves private surfaces alone", async () => {
  const env = await mount({ enabled: false })
  let prevented
  env.doc.addEventListener("click", (event) => {
    prevented = event.defaultPrevented
    event.preventDefault()
  })
  await click(env, "/ru/contracts")
  assert.equal(prevented, false)
  assert.equal(env.requests.length, 0)
  await close(env)
})

test("an invalid destination cannot replace visible copy or document metadata", async () => {
  const env = await mount()
  await click(env, "/ru/contracts")
  await respond(env, env.requests[0], "/ru/contracts", { invalid: true })
  assert.equal(env.doc.querySelector("h1").textContent, "ru about")
  assert.equal(env.doc.title, "ru about")
  assert.equal(env.w.location.pathname, "/ru/about")
  assert.equal(env.doc.querySelector("[data-pending]").textContent, "false")
  assert.ok(
    env.errors.some((error) => /navigation/i.test(error.message)),
    "failed enhancement should fall back to document navigation",
  )
  await close(env)
})
