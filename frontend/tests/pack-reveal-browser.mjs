// Build the offline bureau fixture, then run:
// node tests/pack-reveal-browser.mjs <fixture-directory>/pack-reveal.html
// Optional separate Playwright installation: set PACK_REVEAL_PLAYWRIGHT to its module directory.
// PACK_REVEAL_CHROMIUM can point to an existing Chromium executable.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const path = process.argv[2]
assert.ok(path, "Pass the path to the offline pack-reveal.html fixture")
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PACK_REVEAL_PLAYWRIGHT || "playwright")
const viewport = { width: 1100, height: 820 }
const browser = await chromium.launch({ executablePath: process.env.PACK_REVEAL_CHROMIUM })

try {
  const page = await browser.newPage({ viewport, reducedMotion: "no-preference" })
  await page.route(/^https?:/, (route) => route.abort())
  await page.addInitScript(() => {
    localStorage.setItem("dc.ui.language", "en")
    localStorage.setItem(
      "dc.ui.appearance",
      JSON.stringify({ motion: "FULL", effectsQuality: "FULL" }),
    )
  })
  await page.goto(pathToFileURL(resolve(path)).href)
  await page.getByRole("button", { name: "High ranks", exact: true }).click()
  await page.getByRole("button", { name: "Reveal cards" }).click()
  const pack = page.getByRole("button", { name: "Break the seal" })
  await pack.waitFor()
  const started = performance.now()
  for (const seconds of [1, 3, 5, 10, 30, 60, 120]) {
    await page.waitForTimeout(Math.max(0, seconds * 1_000 - (performance.now() - started)))
    const actual = await pack.evaluate((button) => {
      const wrapper = button.querySelector(".pack-envelope-body")
      const rect = wrapper.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      const layers = [button, wrapper]
      return {
        ready:
          button.closest("[data-stage]").dataset.stage === "sealed" &&
          button.getAttribute("aria-disabled") !== "true" &&
          layers.every((layer) => {
            const style = getComputedStyle(layer)
            return (
              style.opacity === "1" && style.visibility === "visible" && style.display !== "none"
            )
          }),
        rect: {
          x: Math.floor(rect.x),
          y: Math.floor(rect.y),
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        },
        hittable: button.contains(hit),
      }
    })
    assert.ok(
      actual.ready && actual.hittable && actual.rect.width > 130 && actual.rect.height > 140,
      `${seconds}s: ${JSON.stringify(actual)}`,
    )
    const pixels = await page.screenshot({ clip: actual.rect })
    const bright = await page.evaluate(async (image) => {
      const picture = new Image()
      picture.src = `data:image/png;base64,${image}`
      await picture.decode()
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 60
      const context = canvas.getContext("2d")
      context.drawImage(picture, 0, 0, 60, 60)
      const { data } = context.getImageData(0, 0, 60, 60)
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (Math.min(data[i], data[i + 1], data[i + 2]) > 120) count++
      }
      return count
    }, pixels.toString("base64"))
    assert.ok(bright > 25, `${seconds}s: sealed artwork and logo must still be painted`)
    console.log(`Sealed pack visible and hittable at ${seconds}s`)
  }

  await pack.click()
  await page.locator('[data-stage="opening"]').waitFor()
  if (await pack.count()) {
    const surface = await pack.evaluate((button) => {
      const style = getComputedStyle(button)
      return [style.backgroundColor, style.backgroundImage, style.borderWidth, style.boxShadow]
    })
    assert.deepEqual(
      surface,
      ["rgba(0, 0, 0, 0)", "none", "0px", "none"],
      "The wrapper button must paint no rectangle",
    )
  }
  await page.locator('[data-stage="cards"]').waitFor()
  assert.equal(await pack.count(), 0, "Discard the wrapper after the deal")

  // Sample real Chromium compositor frames to catch a one- or two-frame disappearance.
  const screenshotStream = await page.context().newCDPSession(page)
  const images = []
  screenshotStream.on("Page.screencastFrame", (frame) => {
    images.push(frame.data)
    void screenshotStream
      .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
      .catch(() => {})
  })
  await screenshotStream.send("Page.startScreencast", {
    format: "jpeg",
    quality: 78,
    maxWidth: 550,
    maxHeight: 410,
    everyNthFrame: 1,
  })
  const card = page.locator(".pack-card-seat").first()
  await card.getByRole("button").click()
  await card.locator('[data-flight="inspect"]').waitFor()
  await page.waitForTimeout(450)
  await screenshotStream.send("Page.stopScreencast")

  const { x, y, width, height } = await card.locator(".card-surface-front").boundingBox()
  const proportion = await page.evaluate(
    async ({ images, viewport, rect }) => {
      const canvas = document.createElement("canvas")
      canvas.width = 60
      canvas.height = 60
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      const ratios = []
      for (const data of images) {
        const img = new Image()
        img.src = `data:image/jpeg;base64,${data}`
        await img.decode()
        const sx = img.width / viewport.width
        const sy = img.height / viewport.height
        ctx.drawImage(
          img,
          (rect.x + rect.width * 0.2) * sx,
          (rect.y + rect.height * 0.27) * sy,
          rect.width * 0.6 * sx,
          rect.height * 0.38 * sy,
          0,
          0,
          canvas.width,
          canvas.height,
        )
        const { data: pixels } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        let orange = 0
        // The orange areas of the bundled offline artwork distinguish the face from the gold FX.
        for (let i = 0; i < pixels.length; i += 4) {
          if (
            pixels[i] > 50 &&
            pixels[i] - pixels[i + 1] > 25 &&
            pixels[i + 1] - pixels[i + 2] > 13
          )
            orange++
        }
        ratios.push(orange / (pixels.length / 4))
      }
      return ratios
    },
    { images, viewport, rect: { x, y, width, height } },
  )
  const painted = proportion.findIndex(
    (sample, index) => sample > 0.14 && proportion[index + 1] > 0.14,
  )
  assert.ok(
    painted >= 0 && proportion.length - painted >= 5,
    "The painted S artwork must span the handoff",
  )
  assert.ok(
    proportion.slice(painted).every((sample) => sample > 0.06),
    `S artwork blinked after first paint: ${JSON.stringify(proportion)}`,
  )
  console.log(
    `Painted S face stayed visible across ${proportion.length - painted} compositor frames`,
  )
} finally {
  await browser.close()
}
