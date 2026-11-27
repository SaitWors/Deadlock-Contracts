import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { build, normalizePath } from "vite"
import { JSDOM } from "jsdom"

let code
const environments = []
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    resolve: { alias: { "@": path.resolve("src") } },
    plugins: [
      {
        name: "admin-console-test-export",
        transform(source, id) {
          if (id === normalizePath(path.resolve("src/Dashboard.tsx")))
            return `${source}\nexport { AdminConsole }\n`
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: "tests/admin-i18n-entry.tsx", name: "AdminI18nTest", formats: ["iife"] },
    },
  })
  code = result[0].output.find((item) => item.type === "chunk").code
})
after(() => {
  for (const dom of environments) dom.window.close()
})
function runtime(fetch, pathname = "/admin") {
  const dom = new JSDOM('<main id="mount"></main>', {
    url: `https://qa.invalid${pathname}`,
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
  w.localStorage.setItem("dc.ui.language", "ru")
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  w.eval(code)
  return { w, doc: w.document, api: w.AdminI18nTest }
}
const response = (data) => ({ ok: true, json: async () => data })
const button = (doc, text) =>
  [...doc.querySelectorAll("button")].find((item) => item.textContent.includes(text))
const field = (doc, text) =>
  [...doc.querySelectorAll("label")]
    .find((item) => item.textContent.includes(text))
    ?.querySelector("input,textarea,select")
function input(w, element, value) {
  const prototype =
    element.tagName === "TEXTAREA"
      ? w.HTMLTextAreaElement.prototype
      : element.tagName === "SELECT"
        ? w.HTMLSelectElement.prototype
        : w.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value)
  element.dispatchEvent(
    new w.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
  )
}
const list = {
  items: [],
  total: 0,
  offset: 0,
  limit: 250,
  phase_counts: {},
  server_time: "2026-09-29T00:00:00Z",
  feature_flags: { enabled: true, site: true, companion: true, telegram_mirror: false },
}

test("the owner reward form binds the selected pack and keeps the same request after a lost response", async () => {
  const submissions = []
  const { w, doc, api } = runtime(async (url, init) => {
    if (init.method === "POST") {
      submissions.push({ url, body: JSON.parse(init.body) })
      if (submissions.length === 1) throw new Error("Connection lost")
      return response({ id: "grant" })
    }
    assert.equal(url, "/api/owner/archive/packs?offset=0")
    return response({
      items: [{ id: "broadcast", revision: 3, title: "Broadcast pack", active: true, ready: true }],
      total: 1,
    })
  })
  let confirmation
  let grants = 0
  w.confirm = (message) => {
    confirmation = message
    return true
  }
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "rewards", {
      actorId: "owner",
      recipient: { id: "streamer", display_name: "Streamer", status: "ACTIVE" },
      csrf: "csrf",
      onGranted: () => grants++,
    })
  })
  await api.act(async () => {
    doc.querySelector("summary").click()
    input(w, field(doc, "Награда"), "packs")
  })
  await api.act(async () => {
    input(w, field(doc, "Конверт"), "broadcast")
    input(w, field(doc, "Количество"), "3")
    input(w, field(doc, "Причина выдачи"), "Турнир стримеров")
  })
  await api.act(async () => button(doc, "Подтвердить выдачу").click())
  assert.match(confirmation, /Streamer.*Broadcast pack × 3/)
  assert.equal(submissions[0].url, "/api/admin/users/streamer/rewards/packs/broadcast")
  assert.equal(submissions[0].body.revision, 3)
  assert.equal(submissions[0].body.quantity, 3)
  await api.act(async () => button(doc, "Повторить сохранённую выдачу").click())
  assert.deepEqual(submissions[1], submissions[0])
  assert.equal(grants, 1)
  assert.equal(w.sessionStorage.getItem("dc-owner-reward:owner:streamer"), null)
  await api.act(async () => root.unmount())
})

test("announcement language changes preserve the draft and submit untranslated API values", async () => {
  let submitted
  const { w, doc, api } = runtime(async (url, init) => {
    if (init.method === "POST") {
      submitted = JSON.parse(init.body)
      return response({
        ok: true,
        item: {
          ...submitted,
          id: "announcement",
          status: "DRAFT",
          phase: "DRAFT",
          revision: 1,
          starts_at: null,
          ends_at: null,
          supersedes_id: null,
          created_by: null,
          updated_by: null,
          published_by: null,
          cancelled_by: null,
          published_at: null,
          cancelled_at: null,
          created_at: list.server_time,
          updated_at: list.server_time,
        },
      })
    }
    return response(list)
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "announcements", {
      csrf: "csrf",
      permissions: ["*"],
      setError: assert.fail,
      setNotice() {},
    })
  })
  await api.act(async () => {
    input(w, field(doc, "Заголовок RU"), "Черновик сохраняется")
    input(w, field(doc, "Текст RU"), "Текст без изменений")
    input(w, field(doc, "Представление"), "MODAL")
  })
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.match(doc.querySelector("h2").textContent, /Announcement center/)
  assert.equal(field(doc, "RU title").value, "Черновик сохраняется")
  assert.equal(field(doc, "RU body").value, "Текст без изменений")
  assert.equal(field(doc, "Presentation").value, "MODAL")
  await api.act(async () => button(doc, "CREATE DRAFT").click())
  assert.equal(submitted.title_ru, "Черновик сохраняется")
  assert.equal(submitted.body_ru, "Текст без изменений")
  assert.equal(submitted.presentation, "MODAL")
  assert.deepEqual(submitted.surfaces, ["SITE_DASHBOARD"])
  assert.deepEqual(submitted.audiences, ["STAFF"])
  await api.act(async () => root.unmount())
})

test("bureau moderation language changes retain the selected decision and reviewer note", async () => {
  let submitted
  const report = {
    id: "report",
    revision: 3,
    kind: "CONTENT",
    status: "OPEN",
    bureau_status: "ACTIVE",
    bureau_name: "Night Office",
    message: "Please review",
    snapshot: {},
    current_artwork: {},
    decision_note: null,
  }
  const { w, doc, api } = runtime(async (url, init) => {
    if (init?.method === "POST") submitted = JSON.parse(init.body)
    return response({ items: [report], total: 1 })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "bureau", { csrf: "csrf" })
  })
  await api.act(async () => button(doc, "Рассмотреть").click())
  await api.act(async () => {
    input(w, field(doc, "Решение"), "FREEZE")
    input(w, field(doc, "Пояснение для автора"), "Moderator note to preserve")
  })
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.match(doc.querySelector("h2").textContent, /Bureau reports/)
  assert.equal(field(doc, "Decision").value, "FREEZE")
  assert.equal(field(doc, "Note for the reporter").value, "Moderator note to preserve")
  await api.act(async () => button(doc, "Confirm decision").click())
  assert.deepEqual(submitted, { revision: 3, action: "FREEZE", note: "Moderator note to preserve" })
  await api.act(async () => root.unmount())
})

test("review language changes retain queue filters and their API codes", async () => {
  const requests = []
  const { w, doc, api } = runtime(async (url) => {
    requests.push(url)
    return response({ items: [], total: 0, offset: 0, limit: 20 })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "reviews", {
      initialItems: [],
      csrf: "csrf",
      currentUserId: "moderator",
      canForceClaim: false,
      setError: assert.fail,
      setNotice() {},
      reloadAll: async () => {},
    })
  })
  await api.act(async () => input(w, doc.querySelectorAll("select")[1], "RANKED"))
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.equal(doc.querySelectorAll("select")[1].value, "RANKED")
  assert.ok(
    [...doc.querySelectorAll("option")].some(
      (item) => item.value === "ALL" && item.textContent === "All modes",
    ),
  )
  assert.ok(
    requests.some(
      (url) => new URL(url, "https://qa.invalid").searchParams.get("mode") === "RANKED",
    ),
  )
  await api.act(async () => root.unmount())
})

test("the admin console keeps all 18 sections and the selected user filter when language changes", async () => {
  const requests = []
  const { w, doc, api } = runtime(async (url) => {
    requests.push(url)
    if (url === "/api/admin/auth/status")
      return response({
        configured: true,
        elevated: true,
        expires_at: "2026-09-29T12:00:00Z",
        ttl_minutes: 30,
        can_manage_roles: true,
        is_staff: true,
        permissions: ["*"],
        admin: {
          id: "owner",
          display_name: "Owner",
          steam_id64: "76561198000000000",
          access_role: "OWNER",
          badges: [],
        },
      })
    return response({ items: [], total: 0, offset: 0, limit: 20 })
  }, "/admin/reviews")
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "console", {
      csrf: "csrf",
      setError: assert.fail,
      setNotice() {},
      reloadAll: async () => {},
    })
  })
  const sections = () =>
    [...doc.querySelectorAll(".dc-admin-mobile-section option")].map((item) => item.value)
  const expectedSections = [
    "overview",
    "users",
    "reviews",
    "bureau_reports",
    "cards",
    "packs",
    "announcements",
    "hero_votes",
    "matches",
    "boards",
    "companions",
    "missions",
    "generator",
    "jobs",
    "outbox",
    "audit",
    "system",
    "contract_relay",
  ]
  assert.deepEqual(sections(), expectedSections)
  await api.act(async () => button(doc, "Игроки").click())
  await api.act(async () => {
    input(w, doc.querySelector(".dc-admin-filterbar input"), "Mandarin")
    input(w, doc.querySelector(".dc-admin-filterbar select"), "MODERATOR")
  })
  await api.act(async () => doc.getElementById("switch-language").click())
  assert.equal(doc.querySelector(".dc-admin-tabs .active").textContent.trim(), "Players")
  assert.equal(doc.querySelector(".dc-admin-mobile-section select").value, "users")
  assert.equal(doc.querySelector(".dc-admin-filterbar input").value, "Mandarin")
  assert.equal(doc.querySelector(".dc-admin-filterbar select").value, "MODERATOR")
  assert.deepEqual(sections(), expectedSections)
  assert.equal(doc.querySelectorAll(".dc-admin-tabs button").length, 18)
  assert.ok(button(doc, "Hero votes"))
  await api.act(async () => button(doc, "Apply").click())
  assert.ok(
    requests.some((url) => {
      const query = new URL(url, "https://qa.invalid").searchParams
      return query.get("query") === "Mandarin" && query.get("role") === "MODERATOR"
    }),
  )
  await api.act(async () => root.unmount())
})

const relayEndpoint = "/api/admin/contract-relay"
const relayObservedAt = "2026-11-27T12:00:00Z"
const emptyEffectiveness = {
  window_start: "2026-11-20T12:00:00Z",
  window_end: relayObservedAt,
  observed_until: relayObservedAt,
  sample_size: 0,
  truncated: false,
  quota_at_match_time: "unobserved",
  cohorts: [],
}
const relayNode = {
  id: "mcg-node",
  enabled: true,
  has_token: true,
  friendship_writes: true,
  status: "online",
  agent_version: "1.2.3",
  last_heartbeat_at: relayObservedAt,
  last_observed_at: relayObservedAt,
  last_successful_cycle_at: null,
  ingest_status: "stale",
  ingest: {
    container_status: "running",
    gc_logs: "stale",
    observed_at: relayObservedAt,
    metrics: { metadata_used: 0 },
  },
  history: [
    {
      observed_at: relayObservedAt,
      received_at: relayObservedAt,
      events: ["friendship_sync_failed"],
      container_status: "running",
    },
  ],
}
const relayOverview = {
  integration_enabled: true,
  nodes: [relayNode],
  participants: { connected: 2, pending: 1, disconnected: 0, error: 0 },
}

function relayAuth(accessRole, permissions, elevated = true) {
  return {
    configured: true,
    elevated,
    expires_at: elevated ? relayObservedAt : null,
    ttl_minutes: 30,
    is_staff: true,
    permissions,
    admin: {
      id: "operator",
      display_name: "Operator",
      steam_id64: "76561198000000000",
      access_role: accessRole,
      badges: [],
    },
  }
}

const mountRelayConsole = ({ doc, api }) =>
  api.mount(doc.getElementById("mount"), "console", {
    csrf: "relay-csrf",
    setError: assert.fail,
    setNotice() {},
    reloadAll: async () => {},
  })

test("Relay operations show independent host freshness and require confirmation and CSRF", async () => {
  const mutations = []
  let nodes = relayOverview.nodes
  const view = runtime(async (url, init) => {
    if (url === "/api/admin/auth/status") return response(relayAuth("OWNER", ["*"]))
    if (url === relayEndpoint) return response({ ...relayOverview, nodes })
    if (url === `${relayEndpoint}/effectiveness`) return response(emptyEffectiveness)
    if (url === `${relayEndpoint}/nodes/mcg-node`) {
      const action = JSON.parse(init.body).action
      mutations.push({ action, csrf: init.headers.get("X-CSRF-Token"), method: init.method })
      nodes = [{ ...relayNode, enabled: false, has_token: action !== "revoke", status: "disabled" }]
      return response({ ok: true })
    }
    return response(list)
  }, "/admin/reviews")
  const { w, doc, api } = view
  let root
  await api.act(async () => {
    root = mountRelayConsole(view)
  })
  await api.act(async () => button(doc, "Contract Relay").click())
  const remote = doc.querySelector(".dc-relay-node")
  assert.match(remote.textContent, /На связи/)
  assert.match(remote.textContent, /Устаревший отчёт/)
  assert.match(remote.textContent, /Квота метаданныхИспользовано 0/)
  assert.match(remote.textContent, /Квота истории матчейНеизвестно/)
  assert.equal(remote.querySelector("time").dateTime, relayObservedAt)
  assert.match(doc.querySelector(".dc-relay-console").textContent, /Пока нет наблюдений/)
  assert.ok(remote.querySelector("details summary"))

  w.confirm = () => false
  await api.act(async () => button(doc, "Отключить узел").click())
  assert.deepEqual(mutations, [])

  let question
  w.confirm = (value) => {
    question = value
    return true
  }
  await api.act(async () => button(doc, "Отключить узел").click())
  assert.match(question, /mcg-node.*ключ можно снова включить/)
  assert.deepEqual(mutations[0], { action: "disable", csrf: "relay-csrf", method: "POST" })
  assert.ok(button(doc, "Включить узел"))

  await api.act(async () => button(doc, "Отозвать ключ").click())
  assert.match(question, /mcg-node.*нужен новый ключ/)
  assert.deepEqual(mutations[1], { action: "revoke", csrf: "relay-csrf", method: "POST" })
  assert.equal(button(doc, "Включить узел"), undefined)
  assert.equal(button(doc, "Отозвать ключ"), undefined)
  await api.act(async () => root.unmount())
})

test("Relay admin visibility follows system permission and elevation, and admins cannot change node keys", async () => {
  for (const [auth, tabExpected] of [
    [relayAuth("ADMIN", ["users.read"]), false],
    [relayAuth("OWNER", ["*"], false), false],
    [relayAuth("ADMIN", ["system.read"]), true],
  ]) {
    let relayRequests = 0
    const view = runtime(async (url) => {
      if (url === "/api/admin/auth/status") return response(auth)
      if (url === "/api/admin/system") return response(null)
      if (url === relayEndpoint) {
        relayRequests++
        return response(relayOverview)
      }
      if (url === `${relayEndpoint}/effectiveness`) return response(emptyEffectiveness)
      return response(list)
    }, "/admin/reviews")
    const { doc, api } = view
    let root
    await api.act(async () => {
      root = mountRelayConsole(view)
    })
    assert.equal(Boolean(button(doc, "Contract Relay")), tabExpected)
    assert.equal(relayRequests, 0)
    if (tabExpected) {
      await api.act(async () => button(doc, "Contract Relay").click())
      assert.equal(relayRequests, 1)
      assert.ok(doc.querySelector(".dc-relay-node"))
      assert.equal(button(doc, "Отключить узел"), undefined)
      assert.equal(button(doc, "Отозвать ключ"), undefined)
    }
    await api.act(async () => root.unmount())
  }
})

test("an expired Relay admin session returns to TOTP", async () => {
  const view = runtime(async (url) => {
    if (url === "/api/admin/auth/status") return response(relayAuth("OWNER", ["*"]))
    if (url === relayEndpoint)
      return { ok: false, status: 403, json: async () => ({ detail: "TOTP" }) }
    if (url === `${relayEndpoint}/effectiveness`) return response(emptyEffectiveness)
    return response(list)
  }, "/admin/reviews")
  const { doc, api } = view
  let root
  await api.act(async () => {
    root = mountRelayConsole(view)
  })
  await api.act(async () => button(doc, "Contract Relay").click())
  assert.ok(doc.querySelector('input[autocomplete="one-time-code"]'))
  assert.equal(doc.querySelector(".dc-relay-console"), null)
  await api.act(async () => root.unmount())
})

test("player Relay status preserves opt-out and distinguishes sync from manual confirmation", async () => {
  const connection = {
    id: "connection-id",
    consented_at: relayObservedAt,
    friendship_confirmed_at: null,
    status: "connected",
    friendship_source: "relay_manual",
    friendship_observed_at: relayObservedAt,
  }
  const requests = []
  const statuses = [
    [{ ...connection }, /подтверждена на узле Relay/],
    [{ ...connection, friendship_source: "manual" }, /подтверждена вручную/],
    [
      { ...connection, status: "pending", friendship_source: null, friendship_observed_at: null },
      /ожидает проверки/,
    ],
    [{ ...connection, status: "error" }, /не удалось проверить/],
    [{ ...connection, status: "disconnected" }, /не найдена/],
    [{ ...connection, status: "pending" }, /состояние дружбы неизвестно/i],
  ]
  for (const [data, expected] of statuses) {
    const { doc, api } = runtime(async (url, init) => {
      assert.equal(url, "/api/profile/contract-relay")
      if (init.method === "DELETE") {
        requests.push(init.headers.get("X-CSRF-Token"))
        return response({ connection: null })
      }
      return response({ connection: data })
    })
    let root
    await api.act(async () => {
      root = api.mount(doc.getElementById("mount"), "relayProfile", { csrf: "relay-csrf" })
    })
    assert.match(doc.querySelector('[role="status"]').textContent, expected)
    assert.equal(doc.querySelector(".dc-relay-consent-id"), null)
    assert.equal(doc.querySelector("time")?.dateTime ?? null, data.friendship_observed_at)
    await api.act(async () => button(doc, "Отключить участие").click())
    assert.match(doc.querySelector('[role="status"]').textContent, /Участие выключено/)
    await api.act(async () => root.unmount())
  }
  assert.deepEqual(requests, Array(statuses.length).fill("relay-csrf"))
})

test("Quick Invite opens Steam only after the player invokes the protected action", async () => {
  const inviteUrl = "https://s.team/p/abcd-efgh/AbC123XY"
  const actionCalls = []
  const { w, doc, api } = runtime(async (url, init) => {
    if (url === "/api/profile/contract-relay/quick-invite") {
      actionCalls.push([init.method, init.headers.get("X-CSRF-Token")])
      return response({ url: inviteUrl })
    }
    assert.equal(url, "/api/profile/contract-relay")
    return response({
      connection: {
        id: "connection-id",
        consented_at: relayObservedAt,
        friendship_confirmed_at: null,
        status: "pending",
        quick_invite_expires_at: relayObservedAt,
      },
    })
  })
  const navigations = []
  w.HTMLAnchorElement.prototype.click = function () {
    navigations.push([this.href, this.referrerPolicy])
  }
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "relayProfile", { csrf: "relay-csrf" })
  })
  assert.deepEqual(actionCalls, [])
  assert.ok(doc.querySelector('a[href="https://steamcommunity.com/id/deadlock-contracts-relay/"]'))
  assert.equal(doc.querySelector(`a[href="${inviteUrl}"]`), null)
  await api.act(async () => button(doc, "Открыть Quick Invite в Steam").click())
  assert.deepEqual(actionCalls, [["POST", "relay-csrf"]])
  assert.deepEqual(navigations, [[inviteUrl, "no-referrer"]])
  await api.act(async () => root.unmount())
})

test("Relay cohort latency renders only observed values and exposes missing outcomes", async () => {
  const observed = { observed_count: 1, median_seconds: 30, p90_seconds: 30 }
  const unobserved = { observed_count: 0, median_seconds: null, p90_seconds: null }
  const effectiveness = {
    ...emptyEffectiveness,
    sample_size: 2,
    unknown_match_end_count: 1,
    cohorts: [
      {
        relay: "unknown",
        companion: "unobserved",
        mode: "STANDARD",
        sample_size: 2,
        metadata_unobserved_count: 1,
        unresolved_count: 2,
        confirmed_share: 0,
        discovery: observed,
        verification: unobserved,
        after_discovery: unobserved,
      },
    ],
  }
  const view = runtime(async (url) => {
    if (url === "/api/admin/auth/status") return response(relayAuth("OWNER", ["*"]))
    if (url === relayEndpoint) return response(relayOverview)
    if (url === `${relayEndpoint}/effectiveness`) return response(effectiveness)
    return response(list)
  }, "/admin/reviews")
  const { doc, api } = view
  let root
  await api.act(async () => {
    root = mountRelayConsole(view)
  })
  await api.act(async () => button(doc, "Contract Relay").click())
  const row = doc.querySelector(".dc-relay-table tbody tr")
  assert.match(row.querySelector("th").textContent, /Статус Relay неизвестен/)
  assert.match(row.textContent, /Сигнал не зафиксирован/)
  assert.match(row.textContent, /30.*n=1/)
  assert.match(row.textContent, /— \/ — · n=0/)
  assert.match(doc.querySelector(".dc-relay-console").textContent, /Без времени окончания · 1/)
  await api.act(async () => root.unmount())
})

test("Relay exposes the current consent ID on the admin player detail only", async () => {
  const consentId = "0f6b25d7-bac1-4f82-8979-b46996274f61"
  const { doc, api } = runtime(async (url) => {
    assert.equal(url, "/api/admin/users/player-id/contract-relay")
    return response({
      connection: {
        id: consentId,
        consented_at: relayObservedAt,
        friendship_confirmed_at: null,
        status: "pending",
      },
    })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "relayProfile", {
      csrf: "relay-csrf",
      userId: "player-id",
    })
  })
  assert.equal(doc.querySelector(".dc-relay-consent-id").textContent, consentId)
  await api.act(async () => root.unmount())
})

test("Relay automatic enrollment shows one Steam link without a separate opt-in", async () => {
  const calls = []
  const { doc, api } = runtime(async (url, init) => {
    calls.push([url, init.method])
    return response({ connection: null, auto_enrollment: { blocked: false } })
  })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "relayProfile", { csrf: "relay-csrf" })
  })
  assert.match(doc.querySelector('[role="status"]').textContent, /Не подключён/)
  const link = doc.querySelector(
    'a[href="https://steamcommunity.com/id/deadlock-contracts-relay/"]',
  )
  assert.match(link.textContent, /Добавить в друзья/)
  assert.equal(button(doc, "Согласен участвовать"), undefined)
  assert.equal(calls.length, 1)
  await api.act(async () => root.unmount())
})

test("Relay automatic enrollment hides technical details and keeps the opt-out", async () => {
  const { doc, api } = runtime(async () =>
    response({
      auto_enrollment: { blocked: false },
      connection: {
        id: "connection-id",
        consented_at: relayObservedAt,
        friendship_confirmed_at: null,
        friendship_observed_at: relayObservedAt,
        status: "connected",
        friendship_source: "steam_web_api",
      },
    }),
  )
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "relayProfile", { csrf: "relay-csrf" })
  })
  assert.match(doc.querySelector('[role="status"]').textContent, /Подключён/)
  assert.equal(doc.querySelector("time"), null)
  assert.equal(doc.querySelector(".dc-relay-consent-id"), null)
  assert.ok(button(doc, "Отключить участие"))
  await api.act(async () => root.unmount())
})

test("the Relay profile refreshes after the player returns from Steam", async () => {
  let connected = false
  const { w, doc, api } = runtime(async (url) => {
    assert.equal(url, "/api/profile/contract-relay")
    return response({
      auto_enrollment: { blocked: false },
      connection: connected
        ? { id: "connection-id", status: "connected", friendship_source: "steam_session" }
        : null,
    })
  })
  Object.defineProperty(doc, "visibilityState", { value: "visible" })
  let root
  await api.act(async () => {
    root = api.mount(doc.getElementById("mount"), "relayProfile", { csrf: "relay-csrf" })
  })
  assert.equal(doc.querySelector('[role="status"]').textContent, "Не подключён")
  connected = true
  await api.act(async () => doc.dispatchEvent(new w.Event("visibilitychange")))
  assert.equal(doc.querySelector('[role="status"]').textContent, "Подключён")
  assert.ok(button(doc, "Отключить участие"))
  await api.act(async () => root.unmount())
})
