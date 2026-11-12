import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { build } from "vite"
import { JSDOM } from "jsdom"

let code
const environments = []
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    resolve: { alias: { "@": path.resolve("src") } },
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: "tests/public-content-entry.tsx",
        name: "PublicContentTest",
        formats: ["iife"],
      },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => environments.forEach((dom) => dom.window.close()))
function runtime(fetch, language = "en") {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: "https://qa.invalid",
    runScripts: "outside-only",
  })
  environments.push(dom)
  const w = dom.window
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.Headers = Headers
  w.AbortController = AbortController
  w.fetch = fetch
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.localStorage.setItem("dc.ui.language", language)
  w.eval(code)
  return { w, api: w.PublicContentTest, doc: w.document }
}
const response = (data) => ({ ok: true, json: async () => data })
const preview = {
  available: true,
  next_reset_at: "2026-11-14T00:00:00+00:00",
  cards: [
    {
      id: "example-card",
      rank: "F",
      title: "Current card",
      hero_name: "Abrams",
      image_url: "/api/public/archive/preview/example/image",
      crop_x: 50,
      crop_y: 50,
      zoom: 1,
      source_url: "",
      release_poster: false,
    },
  ],
}

test("public explanations are native closed disclosures after useful content and keep one page heading", async () => {
  const { api, doc, w } = runtime(() => {
    throw new Error("No network needed")
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "document", "en", {
      heading: "Collection",
      intro: "One free pack per day.",
      sections: [{ heading: "Your cards stay", text: "They are saved before the reveal." }],
    })
  })
  assert.equal(doc.querySelectorAll("h1").length, 1)
  const details = doc.querySelector("details")
  assert.equal(details.open, false)
  assert.equal(doc.querySelector(".ns-document-number"), null)
  assert.ok(
    doc.querySelector("[data-functional-content]").compareDocumentPosition(details) &
      w.Node.DOCUMENT_POSITION_FOLLOWING,
  )
  await api.act(async () => details.querySelector("summary").click())
  assert.equal(details.open, true)
  assert.match(details.textContent, /They are saved before the reveal/)
  await api.act(async () => root.unmount())
})

test("collection uses only current server preview cards, preserves reset timestamp, and retries a failed read", async () => {
  const calls = []
  const { api, doc } = runtime(async (url, init) => {
    calls.push({ url, init })
    return calls.length === 1
      ? { ok: false, status: 503, json: async () => null }
      : response(preview)
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "collection", "en")
  })
  assert.match(doc.querySelector('[role="alert"]').textContent, /Could not load/)
  assert.equal(doc.querySelectorAll(".archive-card").length, 0)
  await api.act(async () => doc.querySelector("button").click())
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, "/api/public/archive/preview")
  assert.equal(calls[1].init.credentials, "same-origin")
  assert.equal(doc.querySelectorAll(".archive-card").length, 1)
  assert.equal(
    doc.querySelector(".archive-card img").getAttribute("src"),
    preview.cards[0].image_url,
  )
  assert.match(doc.querySelector(".collection-preview-caption").textContent, /selected at random/)
  assert.equal(doc.querySelector("time").dateTime, preview.next_reset_at)
  assert.match(doc.body.textContent, /1 free pack per day/)
  assert.match(doc.body.textContent, /00:00 UTC/)
  await api.act(async () => root.unmount())
})

test("unavailable daily pool is an honest empty state, not an invented pack or reward", async () => {
  const { api, doc } = runtime(
    async () => response({ ...preview, available: false, cards: [] }),
    "ru",
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "collection", "ru")
  })
  assert.equal(doc.querySelectorAll(".archive-card").length, 0)
  assert.match(doc.querySelector('[role="status"]').textContent, /временно недоступен/)
  assert.match(doc.querySelector("button").textContent, /Обновить/)
  assert.match(doc.body.textContent, /1 бесплатный пак в день/)
  await api.act(async () => root.unmount())
})

test("public preview preserves full artwork without an unverified release identity or saved crop", async () => {
  const card = { ...preview.cards[0], crop_x: 90, crop_y: 20, zoom: 1.75 }
  delete card.release_poster
  const { api, doc } = runtime(async () => response({ ...preview, cards: [card] }))
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "collection", "en")
  })
  const artwork = doc.querySelector(".archive-card")
  const image = artwork.querySelector("img")
  assert.equal(artwork.dataset.fullArtwork, "true")
  assert.equal(artwork.dataset.release, undefined)
  assert.equal(image.style.objectFit, "contain")
  assert.equal(image.style.objectPosition, "50% 50%")
  assert.equal(image.style.transform, "none")
  assert.match(artwork.textContent, /Current card/)
  assert.equal(artwork.dataset.rank, card.rank)
  await api.act(async () => root.unmount())
})
