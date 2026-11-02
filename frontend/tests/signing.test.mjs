import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { build } from "vite"
import { JSDOM } from "jsdom"

let code
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
      lib: { entry: "tests/dom-entry.tsx", name: "BureauTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
const environments = []
after(() => {
  for (const dom of environments) dom.window.close()
})
function runtime(language = "ru", reducedMotion = true) {
  // No network resources or browser navigation. JSDOM cannot validate layout,
  // native modal focus trapping, touch interaction, or the animation's appearance.
  const dom = new JSDOM('<button id="trigger">Sign</button><main id="mount"></main>', {
    url: "https://qa.invalid",
    runScripts: "outside-only",
  })
  environments.push(dom)
  const w = dom.window
  w.IS_REACT_ACT_ENVIRONMENT = true
  w.MessageChannel = class {
    port1 = { onmessage: null }
    port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }
  }
  w.localStorage.setItem("dc.ui.language", language)
  const motionListeners = new Set()
  const motionMedia = {
    get matches() {
      return reducedMotion
    },
    addEventListener(_event, listener) {
      motionListeners.add(listener)
    },
    removeEventListener(_event, listener) {
      motionListeners.delete(listener)
    },
  }
  w.matchMedia = (query) =>
    query.includes("prefers-reduced-motion")
      ? motionMedia
      : { matches: true, addEventListener() {}, removeEventListener() {} }
  w.setReducedMotion = (next) => {
    reducedMotion = next
    for (const listener of motionListeners) listener({ matches: next })
  }
  w.HTMLMediaElement.prototype.play = async function () {}
  w.HTMLMediaElement.prototype.pause = function () {}
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
  w.eval(code)
  return { w, api: w.BureauTest, document: w.document }
}
function board(overrides = {}) {
  return {
    id: "board-a",
    generation: 1,
    game_match_mode: "STANDARD",
    status: "OFFERED",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    options: [
      { id: "one", selected: false },
      { id: "two", selected: false },
      { id: "three", selected: false },
      { id: "four", selected: false },
    ],
    ...overrides,
  }
}
const selection = { boardId: "board-a", generation: 1, mode: "STANDARD", optionIds: ["one", "two"] }
function locked(overrides = {}) {
  return board({
    status: "LOCKED",
    locked_at: "2026-09-07T12:00:00Z",
    expires_at: "2026-09-07T18:00:00Z",
    max_attempts: 5,
    options: board().options.map((o) => ({ ...o, selected: selection.optionIds.includes(o.id) })),
    ...overrides,
  })
}

for (const [label, change] of [
  ["different board", { id: "board-b" }],
  ["new generation", { generation: 2 }],
  ["different mode", { game_match_mode: "RANKED" }],
  ["expired offer", { expires_at: "2000-01-01" }],
  ["invalid expiry", { expires_at: "invalid" }],
  ["missing option", { options: [] }],
])
  test(`stale selection: ${label} never posts`, async () => {
    const { api } = runtime()
    let posts = 0
    await assert.rejects(
      api.signSelection(
        selection,
        async () => board(change),
        async () => {
          posts++
          return locked()
        },
      ),
      api.SelectionChangedError,
    )
    assert.equal(posts, 0)
  })
for (const ids of [[], ["one", "one"], ["one", "two", "three", "four"]])
  test(`invalid selection (${ids.join(",")}) never posts`, async () => {
    const { api } = runtime()
    let posts = 0
    await assert.rejects(
      api.signSelection(
        { ...selection, optionIds: ids },
        async () => board(),
        async () => {
          posts++
          return locked()
        },
      ),
      api.SelectionChangedError,
    )
    assert.equal(posts, 0)
  })
test("only a matching authoritative lock confirms the signature", async () => {
  const { api } = runtime()
  const events = []
  const result = await api.signSelection(
    selection,
    async () => {
      events.push("read")
      return board()
    },
    async () => {
      events.push("post")
      return locked()
    },
  )
  assert.deepEqual(events, ["read", "post"])
  assert.equal(result.status, "LOCKED")
})
test("a matching lock from another tab does not submit twice", async () => {
  const { api } = runtime()
  let posts = 0
  const result = await api.signSelection(
    selection,
    async () => locked(),
    async () => {
      posts++
      return locked()
    },
  )
  assert.equal(result.status, "LOCKED")
  assert.equal(posts, 0)
})
test("a different selection in another tab cannot be reported as success", async () => {
  const { api } = runtime()
  await assert.rejects(
    api.signSelection(
      selection,
      async () =>
        locked({
          options: [
            { id: "one", selected: true },
            { id: "two", selected: false },
          ],
        }),
      async () => locked(),
    ),
    api.SelectionChangedError,
  )
})
test("a lost POST response is recovered by reading the server, without another POST", async () => {
  const { api } = runtime()
  let reads = 0
  let posts = 0
  const result = await api.signSelection(
    selection,
    async () => (++reads === 1 ? board() : locked()),
    async () => {
      posts++
      throw new Error("network lost")
    },
  )
  assert.equal(result.status, "LOCKED")
  assert.equal(reads, 2)
  assert.equal(posts, 1)
})
test("an unreachable recovery leaves the signature unconfirmed", async () => {
  const { api } = runtime()
  let reads = 0
  await assert.rejects(
    api.signSelection(
      selection,
      async () => {
        if (++reads > 1) throw new Error("offline")
        return board()
      },
      async () => {
        throw new Error("offline")
      },
    ),
    api.SigningUnconfirmedError,
  )
})
test("a rejected lock with an unchanged board remains retryable", async () => {
  const { api } = runtime()
  const failure = new Error("rejected")
  await assert.rejects(
    api.signSelection(
      selection,
      async () => board(),
      async () => {
        throw failure
      },
    ),
    (error) => error === failure,
  )
})
test("a stale response after a conflict requires choosing again", async () => {
  const { api } = runtime()
  let reads = 0
  await assert.rejects(
    api.signSelection(
      selection,
      async () => (++reads === 1 ? board() : board({ generation: 2 })),
      async () => {
        throw new Error("409")
      },
    ),
    api.SelectionChangedError,
  )
})
test("an invalid successful POST body never produces a success seal", async () => {
  const { api } = runtime()
  await assert.rejects(
    api.signSelection(
      selection,
      async () => board(),
      async () => board(),
    ),
    api.SigningUnconfirmedError,
  )
})
const options = [
  {
    id: "one",
    title: "Точный расчёт <script>alert(1)</script>",
    description: "Нанесите 20 000 урона героям за матч.",
    reward: 150,
  },
  {
    id: "two",
    title: "Поддержка команды",
    description: "Совершите 12 содействий за матч.",
    reward: 200,
  },
]
async function mount(props = {}, language = "ru", reducedMotion = true) {
  const env = runtime(language, reducedMotion)
  let instance
  const trigger = env.document.getElementById("trigger")
  trigger.focus()
  const base = {
    mode: "Standard",
    accountId: "qa-account",
    operator: "Тестовый исполнитель",
    options,
    changed: false,
    onSign: async () => locked(),
    onClose() {},
    onOpenCase() {},
    ...props,
  }
  await env.api.act(async () => {
    instance = env.api.mountSigning(env.document.getElementById("mount"), base)
  })
  return {
    ...env,
    base,
    instance,
    trigger,
    button: (text) =>
      [...env.document.querySelectorAll("button")].find((b) => b.textContent === text),
  }
}
test("review exposes actual terms, potential XP, and escaped titles before confirmation", async () => {
  const env = await mount()
  assert.equal(env.document.querySelectorAll(".signing-terms li").length, 2)
  assert.equal(env.document.querySelectorAll("script").length, 0)
  assert.match(env.document.querySelector(".signing-reward").textContent, /350 XP/)
  assert.equal(env.document.activeElement, env.document.querySelector(".signing-heading h2"))
  assert.equal(env.document.querySelectorAll(".signing-seal").length, 0)
  assert.equal(env.document.body.style.overflow, "hidden")
  await env.api.act(async () => env.instance.unmount())
  assert.equal(env.document.activeElement, env.trigger)
  assert.equal(env.document.body.style.overflow, "")
})
for (const layout of ["desktop", "mobile"]) {
  test(`closing a confirmed contract restores visible ${layout} navigation when its trigger is disabled`, async () => {
    const env = await mount()
    const header = env.document.createElement("header")
    header.innerHTML = '<button class="bureau-brand">Header home</button>'
    const sidebar = env.document.createElement("aside")
    sidebar.innerHTML = '<button class="ns-sidebar-brand">Sidebar home</button>'
    env.document.body.append(header, sidebar)
    const headerBrand = header.querySelector("button")
    const sidebarBrand = sidebar.querySelector("button")
    if (layout === "desktop") headerBrand.style.display = "none"
    else sidebar.style.display = "none"
    await env.api.act(async () => env.button("Поставить печать").click())
    assert.ok(env.document.querySelector(".signing-seal"))
    env.trigger.disabled = true
    await env.api.act(async () => env.instance.unmount())
    assert.equal(env.document.activeElement, layout === "desktop" ? sidebarBrand : headerBrand)
  })
}
test("the optional autograph previews escaped text and falls back to the operator when blank", async () => {
  const env = await mount({}, "en")
  const input = env.document.querySelector('input[name="signature"]')
  assert.ok(input, "An optional signature input is available during review")
  assert.ok(env.document.querySelector(`label[for="${input.id}"]`))
  assert.equal(input.required, false)
  assert.equal(input.value, "Тестовый исполнитель")
  const edit = async (value) => {
    await env.api.act(async () => {
      Object.getOwnPropertyDescriptor(env.w.HTMLInputElement.prototype, "value").set.call(
        input,
        value,
      )
      input.dispatchEvent(new env.w.Event("input", { bubbles: true }))
    })
  }
  await edit('<img src=x onerror="alert(1)">')
  assert.equal(
    env.document.querySelector(".signing-autograph").textContent,
    '<img src=x onerror="alert(1)">',
  )
  assert.equal(env.document.querySelector(".signing-autograph img"), null)
  await edit("   ")
  assert.equal(env.document.querySelector(".signing-autograph").textContent, "Тестовый исполнитель")
  assert.equal(env.button("Place seal").disabled, false)
  await env.api.act(async () => env.button("Place seal").click())
  assert.ok(env.button("Open case"))
  await env.api.act(async () => env.instance.unmount())
})
test("pending freezes the autograph and a failed confirmation keeps it available for retry", async () => {
  let reject
  const env = await mount(
    {
      onSign: () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    },
    "en",
  )
  const input = env.document.querySelector('input[name="signature"]')
  assert.ok(input, "The operator can personalize the autograph before signing")
  await env.api.act(async () => {
    Object.getOwnPropertyDescriptor(env.w.HTMLInputElement.prototype, "value").set.call(
      input,
      "Night operator",
    )
    input.dispatchEvent(new env.w.Event("input", { bubbles: true }))
  })
  await env.api.act(async () => env.button("Place seal").click())
  assert.equal(input.disabled, true)
  assert.equal(env.document.querySelector(".signing-autograph").textContent, "Night operator")
  assert.equal(env.document.querySelectorAll(".signing-seal").length, 0)
  await env.api.act(async () => reject(new Error("offline")))
  assert.equal(input.disabled, false)
  assert.equal(input.value, "Night operator")
  assert.equal(env.document.querySelector(".signing-autograph").textContent, "Night operator")
  assert.equal(env.button("Place seal").disabled, false)
  assert.match(env.document.querySelector('[role="alert"]').textContent, /selection is preserved/)
  await env.api.act(async () => env.instance.unmount())
})

test("a personal autograph survives reopening and is isolated from another account", async () => {
  const env = await mount({}, "en")
  await env.api.act(async () => {
    const input = env.document.querySelector('input[name="signature"]')
    Object.getOwnPropertyDescriptor(env.w.HTMLInputElement.prototype, "value").set.call(
      input,
      "Night clerk",
    )
    input.dispatchEvent(new env.w.Event("input", { bubbles: true }))
  })
  await env.api.act(async () => env.instance.unmount())
  await env.api.act(async () => {
    env.instance = env.api.mountSigning(env.document.getElementById("mount"), env.base)
  })
  assert.equal(env.document.querySelector('input[name="signature"]').value, "Night clerk")
  await env.api.act(async () => env.instance.unmount())
  await env.api.act(async () => {
    env.instance = env.api.mountSigning(env.document.getElementById("mount"), {
      ...env.base,
      accountId: "second-account",
    })
  })
  assert.equal(env.document.querySelector('input[name="signature"]').value, env.base.operator)
  await env.api.act(async () => env.instance.unmount())
})

test("drawn signature can be undone, cleared, and reopened without SVG markup storage", async () => {
  const env = await mount({}, "en")
  assert.ok(env.button("Draw"), "Drawing alternative is available")
  await env.api.act(async () => env.button("Draw").click())
  const svg = env.document.querySelector(".signature-pad")
  svg.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 120 })
  svg.setPointerCapture = () => {}
  svg.hasPointerCapture = () => false
  const pointer = async (name, x, y) =>
    env.api.act(async () => {
      const event = new env.w.MouseEvent(name, { bubbles: true, button: 0, clientX: x, clientY: y })
      Object.defineProperty(event, "pointerId", { value: 1 })
      svg.dispatchEvent(event)
    })
  await pointer("pointerdown", 20, 80)
  await pointer("pointermove", 150, 30)
  await pointer("pointerup", 240, 70)
  assert.equal(svg.querySelectorAll("path").length, 1)
  await pointer("pointerdown", 270, 20)
  await pointer("pointerup", 270, 20)
  assert.equal(svg.querySelectorAll("path").length, 2, "Tapped dots are part of the autograph")
  await env.api.act(async () => env.instance.unmount())
  await env.api.act(async () => {
    env.instance = env.api.mountSigning(env.document.getElementById("mount"), env.base)
  })
  assert.equal(env.document.querySelectorAll(".signature-pad path").length, 2)
  assert.ok(!env.w.localStorage.getItem("dc.signature.v1:qa-account").includes("<"))
  await env.api.act(async () => env.button("Undo stroke").click())
  assert.equal(env.document.querySelectorAll(".signature-pad path").length, 1)
  await env.api.act(async () => env.button("Clear").click())
  assert.equal(env.document.querySelectorAll(".signature-pad path").length, 0)
  await env.api.act(async () => env.instance.unmount())
})
test("cancel preserves selection and never signs", async () => {
  let closes = 0
  let signs = 0
  const env = await mount({
    onClose: () => closes++,
    onSign: async () => {
      signs++
    },
  })
  await env.api.act(async () => env.button("Вернуться к выбору").click())
  assert.equal(closes, 1)
  assert.equal(signs, 0)
  assert.equal(env.document.querySelectorAll(".signing-terms li").length, 2)
  await env.api.act(async () => env.instance.unmount())
})
test("double activation sends once; pending cannot close; success waits for confirmation", async () => {
  let resolve
  let signs = 0
  let closes = 0
  let opens = 0
  const env = await mount({
    onSign: () => {
      signs++
      return new Promise((r) => {
        resolve = r
      })
    },
    onClose: () => closes++,
    onOpenCase: () => opens++,
  })
  const seal = env.button("Поставить печать")
  await env.api.act(async () => {
    seal.click()
    seal.click()
  })
  assert.equal(signs, 1)
  assert.equal(seal.disabled, true)
  env.document
    .querySelector("dialog")
    .dispatchEvent(new env.w.Event("cancel", { cancelable: true }))
  assert.equal(closes, 0)
  assert.equal(env.document.querySelectorAll(".signing-seal").length, 0)
  await env.api.act(async () => resolve(locked()))
  assert.equal(env.document.querySelectorAll(".signing-seal").length, 1)
  assert.match(env.document.querySelector(".signing-receipt").textContent, /board-a/)
  assert.equal(
    env.document.querySelector('time[datetime="2026-09-07T18:00:00Z"]').dateTime,
    "2026-09-07T18:00:00Z",
  )
  assert.equal(env.document.activeElement, env.document.querySelector(".signing-heading h2"))
  await env.api.act(async () => env.button("Открыть дело").click())
  assert.equal(opens, 1)
  await env.api.act(async () => env.instance.unmount())
})
test("failure keeps the terms and supports a successful retry", async () => {
  let signs = 0
  const env = await mount({
    onSign: async () => {
      if (++signs === 1) throw new Error("offline")
      return locked()
    },
  })
  await env.api.act(async () => env.button("Поставить печать").click())
  assert.match(env.document.querySelector('[role="alert"]').textContent, /Ваш выбор сохранён/)
  assert.equal(env.document.querySelectorAll(".signing-terms li").length, 2)
  assert.equal(env.document.querySelectorAll(".signing-seal").length, 0)
  await env.api.act(async () => env.button("Поставить печать").click())
  assert.equal(signs, 2)
  assert.equal(env.document.querySelectorAll(".signing-seal").length, 1)
  await env.api.act(async () => env.instance.unmount())
})
test("a board refresh while reviewing disables confirmation without losing the displayed terms", async () => {
  let signs = 0
  const env = await mount({
    onSign: async () => {
      signs++
    },
  })
  await env.api.act(async () => env.instance.render({ ...env.base, changed: true }))
  assert.equal(env.button("Поставить печать").disabled, true)
  assert.match(env.document.querySelector('[role="alert"]').textContent, /Доска изменилась/)
  assert.equal(signs, 0)
  await env.api.act(async () => env.instance.unmount())
})
test("native cancel before submitting calls onClose", async () => {
  let closes = 0
  const env = await mount({ onClose: () => closes++ })
  env.document
    .querySelector("dialog")
    .dispatchEvent(new env.w.Event("cancel", { cancelable: true }))
  assert.equal(closes, 1)
  await env.api.act(async () => env.instance.unmount())
})
test("English signing copy is complete", async () => {
  const env = await mount({}, "en")
  assert.ok(env.button("Place seal"))
  assert.match(env.document.querySelector(".signing-intro").textContent, /cannot be changed/)
  await env.api.act(async () => env.button("Place seal").click())
  assert.ok(env.button("Open case"))
  await env.api.act(async () => env.instance.unmount())
})

test("shared navigation reports the active page and closes its mobile menu on Escape", async () => {
  const { document, api, w } = runtime()
  let instance
  const navigated = []
  await api.act(async () => {
    instance = api.mountHeader(document.getElementById("mount"), {
      active: "contracts",
      items: [
        { id: "contracts", label: "КОНТРАКТЫ" },
        { id: "history", label: "АРХИВ" },
      ],
      onNavigate: (id) => navigated.push(id),
      actions: null,
    })
  })
  assert.equal(document.querySelector('.bureau-nav [aria-current="page"]').textContent, "КОНТРАКТЫ")
  const toggle = document.querySelector(".bureau-menu-toggle")
  await api.act(async () => toggle.click())
  assert.equal(toggle.getAttribute("aria-expanded"), "true")
  assert.ok(document.getElementById(toggle.getAttribute("aria-controls")))
  const english = [...document.querySelectorAll(".bureau-mobile-preferences button")].find(
    (button) => button.textContent === "EN",
  )
  await api.act(async () => english.click())
  assert.equal(document.documentElement.lang, "en")
  assert.equal(w.localStorage.getItem("dc.ui.language"), "en")
  assert.equal(toggle.getAttribute("aria-label"), "Close menu")

  await api.act(async () =>
    document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" })),
  )
  assert.equal(toggle.getAttribute("aria-expanded"), "false")
  assert.equal(document.activeElement, toggle)
  await api.act(async () => toggle.click())
  await api.act(async () =>
    [...document.querySelectorAll(".bureau-mobile-nav button")]
      .find((button) => button.textContent === "АРХИВ")
      .click(),
  )
  assert.deepEqual(navigated, ["history"])
  assert.equal(toggle.getAttribute("aria-expanded"), "false")
  assert.equal(document.activeElement, toggle)
  await api.act(async () => instance.unmount())
})

test("an uncertain signature explains reconciliation and does not show success", async () => {
  const env = await mount()
  await env.api.act(async () =>
    env.instance.render({
      ...env.base,
      onSign: async () => {
        throw new env.api.SigningUnconfirmedError()
      },
    }),
  )
  await env.api.act(async () => env.button("Поставить печать").click())
  assert.match(
    env.document.querySelector('[role="alert"]').textContent,
    /сначала проверим состояние дела/,
  )
  assert.equal(env.document.querySelectorAll(".signing-seal").length, 0)
  assert.equal(env.button("Поставить печать").disabled, false)
  await env.api.act(async () => env.instance.unmount())
})

test("a stale signing rejection requires returning to the board", async () => {
  const env = await mount()
  await env.api.act(async () =>
    env.instance.render({
      ...env.base,
      onSign: async () => {
        throw new env.api.SelectionChangedError()
      },
    }),
  )
  await env.api.act(async () => env.button("Поставить печать").click())
  assert.equal(env.button("Поставить печать").disabled, true)
  assert.equal(env.button("Вернуться к выбору").disabled, false)
  await env.api.act(async () => env.instance.unmount())
})

test("reduced motion suppresses interactive tilt and ripple", async () => {
  const { document, api, w } = runtime()
  let instance
  await api.act(async () => {
    instance = api.mountMotion(document.getElementById("mount"))
  })
  const button = document.querySelector("main button")
  await api.act(async () => {
    button.dispatchEvent(new w.MouseEvent("mousemove", { bubbles: true, clientX: 80, clientY: 40 }))
    button.dispatchEvent(new w.MouseEvent("click", { bubbles: true, detail: 1 }))
  })
  assert.equal(button.style.transform, "")
  assert.equal(button.querySelectorAll(".ripple-span").length, 0)
  await api.act(async () => instance.unmount())
})

test("completed or expired cases are not presented as newly opened", async () => {
  const { api } = runtime()
  for (const status of ["SETTLED", "EXPIRED", "VOID"]) {
    await assert.rejects(
      api.signSelection(
        selection,
        async () => locked({ status }),
        async () => locked(),
      ),
      api.SelectionChangedError,
    )
  }
})

test("server time takes precedence over a skewed device clock", async () => {
  const { api } = runtime()
  const current = board({ server_time: "2000-01-01T00:00:00Z", expires_at: "2000-01-01T01:00:00Z" })
  const result = await api.signSelection(
    selection,
    async () => current,
    async () => locked(),
  )
  assert.equal(result.status, "LOCKED")
})

test("a receipt without valid server timestamps cannot confirm signing", async () => {
  const { api } = runtime()
  for (const change of [
    { locked_at: null },
    { expires_at: "invalid" },
    { expires_at: "2026-09-07T11:00:00Z" },
  ]) {
    await assert.rejects(
      api.signSelection(
        selection,
        async () => board(),
        async () => locked(change),
      ),
      api.SigningUnconfirmedError,
    )
  }
})

for (const language of ["ru", "en"]) {
  test(`public ${language} preview signs only a demo, retains selection on close, and resets on mode change`, async () => {
    const { api, w, document } = runtime(language)
    w.history.replaceState(null, "", `/${language}/contracts`)
    w.scrollTo = () => {}
    w.IntersectionObserver = class {
      constructor(callback) {
        this.callback = callback
      }
      observe(target) {
        this.callback([{ isIntersecting: true, target }])
      }
      disconnect() {}
    }
    const requests = []
    w.fetch = async (url) => {
      requests.push(url)
      throw new Error("Unexpected public preview request")
    }
    let instance
    await api.act(async () => {
      instance = api.mountLanding(document.getElementById("mount"))
    })
    const preview = [...document.querySelectorAll("button")].find((button) =>
      /Примерить подпись|Preview signing/.test(button.textContent),
    )
    assert.ok(preview)
    assert.equal(preview.disabled, true)
    const cards = [...document.querySelectorAll("[data-contract-choice]")]
    const title = cards[0].querySelector("strong").textContent
    await api.act(async () => cards[0].click())
    assert.equal(preview.disabled, false)
    preview.focus()
    await api.act(async () => preview.click())
    assert.equal(document.querySelectorAll(".signing-terms li").length, 1)
    assert.equal(document.querySelector(".signing-terms h3").textContent, title)
    const sample = [...document.querySelectorAll("dialog button")].find((button) =>
      /Поставить пробную печать|Place sample seal/.test(button.textContent),
    )
    await api.act(async () => sample.click())
    assert.ok(document.querySelector(".signing-seal"))
    assert.ok(document.querySelector(".signing-demo"))
    assert.equal(document.querySelector(".signing-receipt"), null)
    assert.doesNotMatch(
      document.querySelector(".signing-success").textContent,
      /Ваше дело открыто|Your case is open/,
    )
    assert.deepEqual(requests, [])
    await api.act(async () => document.querySelector(".signing-close").click())
    assert.equal(document.activeElement, preview)
    assert.equal(cards[0].getAttribute("aria-pressed"), "true")
    await api.act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => /^(Рейтинговый|Ranked)$/.test(button.textContent.trim()))
        .click(),
    )
    assert.equal(document.querySelectorAll('[data-contract-choice][aria-pressed="true"]').length, 0)
    assert.equal(preview.disabled, true)
    await api.act(async () => instance.unmount())
  })
}

test("native imprint stays on the document, waits for a receipt and skips without resubmitting", async () => {
  let resolve,
    signs = 0
  const env = await mount(
    {
      onSign: () => {
        signs++
        return new Promise((done) => {
          resolve = done
        })
      },
    },
    "en",
    false,
  )
  const paper = env.document.querySelector(".signing-scroll")
  await env.api.act(async () => env.button("Place seal").click())
  assert.equal(paper.querySelector(".signing-seal"), null)
  await env.api.act(async () => resolve(locked()))
  assert.equal(env.document.querySelector("dialog").dataset.state, "sealing")
  assert.equal(env.document.querySelector("video"), null)
  assert.ok(paper.querySelector(".signing-seal"))
  assert.equal(paper.querySelectorAll(".signing-terms li").length, 2)
  await env.api.act(async () => env.button("Skip animation").click())
  assert.equal(env.document.querySelector("dialog").dataset.state, "signed")
  assert.match(paper.querySelector(".signing-receipt").textContent, /board-a/)
  assert.equal(signs, 1)
  assert.equal(env.document.activeElement, env.document.querySelector(".signing-heading h2"))
  await env.api.act(async () => env.instance.unmount())
})

test("reduced motion goes straight to the signed document and keeps terms visible", async () => {
  const env = await mount({}, "en")
  await env.api.act(async () => env.button("Place seal").click())
  assert.equal(env.document.querySelector("dialog").dataset.state, "signed")
  assert.equal(env.document.querySelector("video"), null)
  assert.equal(env.document.querySelectorAll(".signing-terms li").length, 2)
  assert.ok(env.button("Open case"))
  await env.api.act(async () => env.instance.unmount())
})

test("stamp animation completion unlocks the confirmed receipt action", async () => {
  const env = await mount({}, "en", false)
  await env.api.act(async () => env.button("Place seal").click())
  await env.api.act(async () =>
    env.document
      .querySelector(".signing-seal")
      .dispatchEvent(new env.w.Event("animationend", { bubbles: true })),
  )
  assert.ok(env.button("Open case"))
  assert.match(env.document.querySelector(".signing-receipt").textContent, /board-a/)
  await env.api.act(async () => env.instance.unmount())
})

test("Escape skips a confirmed ceremony before closing the receipt", async () => {
  let closes = 0
  const env = await mount({ onClose: () => closes++ }, "en", false)
  await env.api.act(async () => env.button("Place seal").click())
  await env.api.act(async () =>
    env.document
      .querySelector("dialog")
      .dispatchEvent(new env.w.Event("cancel", { cancelable: true })),
  )
  assert.equal(closes, 0)
  assert.ok(env.button("Open case"))
  await env.api.act(async () =>
    env.document
      .querySelector("dialog")
      .dispatchEvent(new env.w.Event("cancel", { cancelable: true })),
  )
  assert.equal(closes, 1)
  await env.api.act(async () => env.instance.unmount())
})

test("enabling reduced motion during the imprint immediately shows the receipt action", async () => {
  const env = await mount({}, "en", false)
  await env.api.act(async () => env.button("Place seal").click())
  await env.api.act(async () => env.w.setReducedMotion(true))
  assert.equal(env.document.querySelector("dialog").dataset.state, "signed")
  assert.ok(env.button("Open case"))
  await env.api.act(async () => env.instance.unmount())
})

test("an empty confirmation cannot create a seal, receipt or animation", async () => {
  const env = await mount({ onSign: async () => undefined }, "en", false)
  await env.api.act(async () => env.button("Place seal").click())
  assert.equal(env.document.querySelector(".signing-seal"), null)
  assert.equal(env.document.querySelector(".signing-receipt"), null)
  assert.equal(env.button("Place seal").disabled, false)
  assert.match(env.document.querySelector('[role="alert"]').textContent, /check the case first/)
  await env.api.act(async () => env.instance.unmount())
})

test("a missing animationend has a bounded fallback and unmount clears the timer", async () => {
  for (const complete of [true, false]) {
    const env = await mount({}, "en", false)
    const callbacks = new Map()
    let id = 100000
    const originalSet = env.w.setTimeout.bind(env.w),
      originalClear = env.w.clearTimeout.bind(env.w)
    env.w.setTimeout = (callback, delay, ...args) => {
      if (delay === 1400) {
        callbacks.set(++id, callback)
        return id
      }
      return originalSet(callback, delay, ...args)
    }
    env.w.clearTimeout = (timer) => {
      callbacks.delete(timer)
      originalClear(timer)
    }
    await env.api.act(async () => env.button("Place seal").click())
    assert.equal(callbacks.size, 1)
    if (complete) {
      await env.api.act(async () => [...callbacks.values()][0]())
      assert.ok(env.button("Open case"))
      assert.equal(callbacks.size, 0)
    }
    await env.api.act(async () => env.instance.unmount())
    assert.equal(callbacks.size, 0)
    assert.equal(env.document.activeElement, env.trigger)
  }
})

test("a confirmation arriving after unmount cannot start a ceremony", async () => {
  let resolve
  const env = await mount(
    {
      onSign: () =>
        new Promise((done) => {
          resolve = done
        }),
    },
    "en",
    false,
  )
  let plays = 0
  env.w.HTMLMediaElement.prototype.play = async () => {
    plays++
  }
  await env.api.act(async () => env.button("Place seal").click())
  await env.api.act(async () => env.instance.unmount())
  await env.api.act(async () => resolve(locked()))
  assert.equal(plays, 0)
  assert.equal(env.document.querySelector("dialog"), null)
  assert.equal(env.document.activeElement, env.trigger)
})

test("malformed and oversized stored signatures safely fall back to the operator", () => {
  const { api, w } = runtime()
  for (const raw of [
    "<svg onload=alert(1)>",
    "{}",
    JSON.stringify({
      mode: "draw",
      text: "x",
      strokes: [
        [
          [2, 0],
          [0, 1],
        ],
      ],
    }),
    JSON.stringify({
      mode: "draw",
      text: "x",
      strokes: [Array.from({ length: 1601 }, () => [0, 0])],
    }),
    " ".repeat(50001),
  ]) {
    w.localStorage.setItem("dc.signature.v1:a", raw)
    const value = api.readSignature("a", "Clerk")
    assert.equal(value.text, "Clerk")
    assert.equal(value.strokes.length, 0)
  }
})

test("blocked signature storage never blocks signing and shows a truthful notice", async () => {
  const env = await mount({}, "en")
  env.w.Storage.prototype.setItem = () => {
    throw new Error("storage blocked")
  }
  await env.api.act(async () => {
    const input = env.document.querySelector('input[name="signature"]')
    Object.getOwnPropertyDescriptor(env.w.HTMLInputElement.prototype, "value").set.call(
      input,
      "Local clerk",
    )
    input.dispatchEvent(new env.w.Event("input", { bubbles: true }))
  })
  assert.match(env.document.querySelector(".signature-hint").textContent, /could not save/)
  await env.api.act(async () => env.button("Place seal").click())
  assert.ok(env.button("Open case"))
  assert.equal(env.document.querySelector(".signing-autograph").textContent, "Local clerk")
  await env.api.act(async () => env.instance.unmount())
})

test("ambient background pauses when hidden, honors reduced motion and keeps a poster on playback failure", async () => {
  const { api, w, document } = runtime("en", false)
  let hidden = false,
    plays = 0,
    pauses = 0,
    instance
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
  w.HTMLMediaElement.prototype.play = async function () {
    plays++
    throw new Error("autoplay blocked")
  }
  w.HTMLMediaElement.prototype.pause = function () {
    pauses++
  }
  await api.act(async () => {
    instance = api.mountAtmosphere(document.getElementById("mount"))
  })
  assert.equal(plays, 1)
  assert.equal(document.querySelector(".bureau-atmosphere").dataset.playing, "false")
  assert.ok(document.querySelector(".bureau-atmosphere img"))
  assert.equal(document.querySelector("video").muted, true)
  await api.act(async () => {
    hidden = true
    document.dispatchEvent(new w.Event("visibilitychange"))
  })
  assert.ok(pauses > 0)
  assert.equal(document.querySelector(".bureau-atmosphere").dataset.moving, "false")
  await api.act(async () => w.setReducedMotion(true))
  assert.equal(document.querySelector("video"), null)
  assert.ok(document.querySelector(".bureau-atmosphere img"))
  await api.act(async () => instance.unmount())
})
