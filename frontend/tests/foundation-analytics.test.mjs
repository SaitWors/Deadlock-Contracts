import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as flushTasks } from "node:timers/promises"
import { trackFoundationEvent } from "../src/foundation/analytics.ts"

test("browser telemetry ignores hidden activity, deduplicates views, and isolates account changes", async (t) => {
  const document = { visibilityState: "hidden" }
  globalThis.document = document
  t.after(() => delete globalThis.document)

  let now = Date.UTC(2026, 10, 28, 8)
  t.mock.method(Date, "now", () => now)
  const requests = []
  let releaseFirstRequest
  t.mock.method(globalThis, "fetch", (url, init) => {
    requests.push({ url, csrf: init.headers["X-CSRF-Token"], body: JSON.parse(init.body) })
    if (requests.length === 1)
      return new Promise((resolve) => {
        releaseFirstRequest = resolve
      })
    return Promise.resolve(new Response(null, { status: 204 }))
  })

  trackFoundationEvent("old-user", "old-csrf", "contract_board_viewed")
  await flushTasks()
  assert.equal(requests.length, 0)

  document.visibilityState = "visible"
  trackFoundationEvent("old-user", "old-csrf", "contract_board_viewed")
  await flushTasks()
  assert.equal(requests[0].body.name, "session_started")

  trackFoundationEvent("new-user", "new-csrf", "collection_viewed")
  trackFoundationEvent("new-user", "new-csrf", "collection_viewed")
  releaseFirstRequest(new Response(null, { status: 204 }))
  await flushTasks()
  assert.deepEqual(
    requests.map(({ csrf, body }) => [csrf, body.name]),
    [
      ["old-csrf", "session_started"],
      ["new-csrf", "session_started"],
      ["new-csrf", "collection_viewed"],
    ],
  )

  now += 30 * 60_000
  trackFoundationEvent("new-user", "new-csrf", "community_viewed")
  await flushTasks()
  assert.deepEqual(
    requests.slice(-2).map(({ body }) => body.name),
    ["session_started", "community_viewed"],
  )
  assert.equal(new Set(requests.map(({ body }) => body.event_id)).size, requests.length)
  for (const { url, body } of requests) {
    assert.equal(url, "/api/foundation/events")
    assert.deepEqual(Object.keys(body).sort(), ["event_id", "name"])
  }
})
