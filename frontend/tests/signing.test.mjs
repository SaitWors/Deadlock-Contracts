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
function runtime(language = "ru") {
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
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
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
async function mount(props = {}, language = "ru") {
  const env = runtime(language)
  let instance
  const trigger = env.document.getElementById("trigger")
  trigger.focus()
  const base = {
    mode: "Standard",
    operator: "Тестовый исполнитель",
    options,
    changed: false,
    onSign: async () => {},
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
  await env.api.act(async () => resolve())
  assert.equal(env.document.querySelectorAll(".signing-seal").length, 1)
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
