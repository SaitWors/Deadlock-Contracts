import { prefersReducedMotion } from "../motion"
import { progressAt } from "./timeline"
import type { CompletionReceipt } from "./types"

export type Meter = { total: number; level: number; value: number; cost: number; percent: number }
export type FinaleFrame = {
  phase: "entering" | "floating" | "flying" | "impact" | "threshold" | "levelup" | "done"
  taskIndex?: number
  taskState?: "pending" | "flying" | "absorbed" | "breaking" | "broken"
  meter?: Meter
  centered?: boolean
  impact?: "hit" | "level"
}
export type FinaleElements = {
  profileEntry: HTMLElement
  profileShift: HTMLElement
  profileDrift: HTMLElement
  profileHit: HTMLElement
  profilePanel: HTMLElement
  levelNumber: HTMLElement
  bar: HTMLElement
  stage: HTMLElement
  entries: HTMLElement[]
  drifts: HTMLElement[]
  flights: HTMLElement[]
  panels: HTMLElement[]
}
const spring = "cubic-bezier(.16,1,.3,1)"
const easing = "cubic-bezier(.22,.7,.2,1)"

// Each transform belongs to one layer: entrance, drift, travel and profile impact
// never overwrite one another. The signal owns every browser animation and timer.
export async function runFinale(
  el: FinaleElements,
  receipt: CompletionReceipt,
  frame: (value: FinaleFrame) => void,
  signal: AbortSignal,
) {
  const animations = new Set<Animation>()
  const timeouts = new Set<number>()
  const rafs = new Set<number>()
  const pending = new Set<() => void>()
  const aborted = () => {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError")
  }
  const cleanup = () => {
    animations.forEach((animation) => animation.cancel())
    timeouts.forEach((timer) => window.clearTimeout(timer))
    rafs.forEach((raf) => window.cancelAnimationFrame(raf))
    pending.forEach((resolve) => resolve())
    pending.clear()
  }
  signal.addEventListener("abort", cleanup, { once: true })
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        pending.delete(done)
        resolve()
      }
      pending.add(done)
      const timer = window.setTimeout(() => {
        timeouts.delete(timer)
        done()
      }, ms)
      timeouts.add(timer)
    }).then(aborted)
  const animate = async (
    element: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => {
    aborted()
    if (typeof element.animate === "function") {
      const animation = element.animate(keyframes, { fill: "forwards", ...options })
      animations.add(animation)
      // XP may change only after the actual flight has finished, not a guessed timeout.
      await animation.finished
      aborted()
      return animation
    }
    await wait(Number(options.delay || 0) + Number(options.duration || 0))
    const end = keyframes[keyframes.length - 1]
    if (end.transform) element.style.transform = String(end.transform)
    if (end.opacity !== undefined) element.style.opacity = String(end.opacity)
    return null
  }
  const meterAt = (total: number): Meter => ({
    total,
    ...progressAt(total, receipt.progression.levels),
  })
  const float = (element: HTMLElement, index: number) => {
    if (typeof element.animate !== "function") return null
    const animation = element.animate(
      [
        {
          transform: `translate3d(0,${index % 2 ? -7 : 5}px,0) rotate(${index % 2 ? -0.45 : 0.35}deg)`,
        },
        {
          transform: `translate3d(0,${index % 2 ? 7 : -6}px,0) rotate(${index % 2 ? 0.5 : -0.4}deg)`,
        },
        {
          transform: `translate3d(0,${index % 2 ? -7 : 5}px,0) rotate(${index % 2 ? -0.45 : 0.35}deg)`,
        },
      ],
      {
        duration: 3800 + index * 510,
        iterations: Infinity,
        easing: "ease-in-out",
        delay: -index * 630,
      },
    )
    animations.add(animation)
    return animation
  }
  const tween = (
    from: number,
    to: number,
    band: CompletionReceipt["progression"]["levels"][number],
  ) =>
    new Promise<void>((resolve) => {
      let start: number | null = null
      const done = () => {
        pending.delete(done)
        resolve()
      }
      pending.add(done)
      const tick = (time: number) => {
        if (signal.aborted) {
          done()
          return
        }
        start ??= time
        const part = Math.min(1, (time - start) / 720)
        const total = Math.round(from + (to - from) * (1 - (1 - part) ** 3))
        const cost = band.end_xp - band.start_xp
        const value = Math.min(cost, Math.max(0, total - band.start_xp))
        frame({
          phase: "impact",
          meter: { total, level: band.level, value, cost, percent: (100 * value) / cost },
        })
        if (part >= 1) done()
        else schedule()
      }
      const schedule = () => {
        const raf = window.requestAnimationFrame((time) => {
          rafs.delete(raf)
          tick(time)
        })
        rafs.add(raf)
      }
      schedule()
    }).then(aborted)
  try {
    aborted()
    // A preference change can restart this run on the same DOM nodes. Retire
    // committed center/fallback styles as well as the previous WAAPI effects.
    for (const element of [
      el.profileEntry,
      el.profileShift,
      el.profileDrift,
      el.profileHit,
      el.levelNumber,
      ...el.entries,
      ...el.drifts,
      ...el.flights,
    ]) {
      element.style.removeProperty("transform")
      element.style.removeProperty("opacity")
    }
    const after = receipt.progression.after
    const before = receipt.progression.before
    if (prefersReducedMotion() || !receipt.replayable || !before || !after) {
      frame({
        phase: "done",
        ...(after
          ? {
              meter: {
                total: after.total_xp,
                level: after.level,
                value: after.level_xp,
                cost: after.next_level_xp,
                percent: after.progress_pct,
              },
            }
          : {}),
      })
      await Promise.all(
        [el.profileEntry, ...el.entries].map((entry) =>
          animate(entry, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 }),
        ),
      )
      return
    }
    frame({ phase: "entering", meter: meterAt(before.total_xp) })
    const entrance = (entry: HTMLElement, delay: number) =>
      animate(
        entry,
        [
          { transform: "translate3d(0,-70vh,0) rotate(-2deg)", opacity: 0, offset: 0 },
          { transform: "translate3d(0,15px,0) rotate(.5deg)", opacity: 1, offset: 0.67 },
          { transform: "translate3d(0,-6px,0) rotate(-.15deg)", opacity: 1, offset: 0.84 },
          { transform: "translate3d(0,0,0) rotate(0deg)", opacity: 1, offset: 1 },
        ],
        { duration: 1050, delay, easing: spring },
      )
    const profileEntrance = entrance(el.profileEntry, 0).then(() => float(el.profileDrift, 0))
    const drifts: (Animation | null)[] = []
    await Promise.all([
      profileEntrance,
      ...el.entries.map((entry, index) =>
        entrance(entry, 250 + index * 150).then(() => {
          drifts[index] = float(el.drifts[index], index + 1)
        }),
      ),
    ])
    frame({ phase: "floating" })
    await wait(620)
    let current = before.total_xp
    let centered: { x: number; y: number } | null = null
    // Clear failed plaques first: the level accent then has an unobstructed
    // center. Successful plaques keep their signed order and fly one at a time.
    const order = receipt.tasks
      .map((_, index) => index)
      .sort(
        (a, b) =>
          Number(receipt.tasks[a].status === "COMPLETED") -
          Number(receipt.tasks[b].status === "COMPLETED"),
      )
    for (const index of order) {
      aborted()
      const task = receipt.tasks[index]
      // Pausing keeps the exact current bob/tilt transform. Travel starts at zero
      // on its own parent layer, so there is no snap back to the grid origin.
      drifts[index]?.pause()
      if (task.status !== "COMPLETED") {
        await animate(el.panels[index], [{ filter: "grayscale(0)" }, { filter: "grayscale(1)" }], {
          duration: 230,
        })
        frame({ phase: "floating", taskIndex: index, taskState: "breaking" })
        await wait(1050)
        frame({ phase: "floating", taskIndex: index, taskState: "broken" })
        continue
      }
      const source = el.panels[index].getBoundingClientRect()
      const bar = el.bar.getBoundingClientRect()
      const currentMeter = meterAt(current)
      const dx =
        bar.left +
        bar.width * Math.min(1, currentMeter.percent / 100) -
        source.left -
        source.width / 2
      const dy = bar.top + bar.height / 2 - source.top - source.height / 2
      frame({ phase: "flying", taskIndex: index, taskState: "flying" })
      await animate(
        el.flights[index],
        [
          { transform: "translate3d(0,0,0) rotate(0deg) scale(1)", opacity: 1, offset: 0 },
          {
            transform: `translate3d(${dx < 0 ? 22 : -22}px,12px,0) rotate(-1deg) scale(1.035)`,
            opacity: 1,
            offset: 0.2,
          },
          {
            transform: `translate3d(${dx * 0.32}px,${dy * 0.25 - 65}px,0) rotate(-5deg) scale(.97)`,
            opacity: 1,
            offset: 0.48,
          },
          {
            transform: `translate3d(${dx * 0.78}px,${dy * 0.72 - 24}px,0) rotate(3deg) scale(.5)`,
            opacity: 0.9,
            offset: 0.78,
          },
          {
            transform: `translate3d(${dx}px,${dy}px,0) rotate(0deg) scale(.025)`,
            opacity: 0,
            offset: 1,
          },
        ],
        { duration: 1100, easing: "cubic-bezier(.35,.02,.64,.42)" },
      )
      frame({ phase: "impact", taskIndex: index, taskState: "absorbed", impact: "hit" })
      void animate(
        el.profileHit,
        [
          { transform: "scale(1)" },
          { transform: "scale(1.045)", offset: 0.35 },
          { transform: "scale(.985)", offset: 0.7 },
          { transform: "scale(1)" },
        ],
        { duration: 490, easing: spring },
      ).catch(() => {})
      const target = current + task.xp
      while (current < target) {
        const bands = receipt.progression.levels
        const band =
          [...bands].reverse().find((candidate) => current >= candidate.start_xp) || bands[0]
        const next = Math.min(target, band.end_xp)
        await tween(current, next, band)
        current = next
        const nextBand = bands.find((candidate) => candidate.level === band.level + 1)
        if (current === band.end_xp && nextBand) {
          frame({
            phase: "threshold",
            meter: {
              total: current,
              level: band.level,
              value: band.end_xp - band.start_xp,
              cost: band.end_xp - band.start_xp,
              percent: 100,
            },
          })
          await wait(260)
          const profile = el.profilePanel.getBoundingClientRect()
          const stage = el.stage.getBoundingClientRect()
          centered ??= {
            x: stage.left + stage.width / 2 - (profile.left + profile.width / 2),
            y: stage.top + stage.height / 2 - (profile.top + profile.height / 2),
          }
          frame({ phase: "levelup", centered: true })
          await animate(
            el.profileShift,
            [
              { transform: el.profileShift.style.transform || "translate3d(0,0,0) scale(1)" },
              { transform: `translate3d(${centered.x}px,${centered.y}px,0) scale(1.09)` },
            ],
            { duration: 570, easing },
          )
          // Commit the center transform to its dedicated layer before retiring
          // its animation; subsequent level accents keep this SAME plaque.
          el.profileShift.style.transform = `translate3d(${centered.x}px,${centered.y}px,0) scale(1.09)`
          frame({ phase: "levelup", meter: meterAt(current), impact: "level", centered: true })
          void animate(
            el.levelNumber,
            [
              { transform: "translateY(12px) scale(.7)", opacity: 0 },
              { transform: "translateY(0) scale(1.6)", opacity: 1, offset: 0.65 },
              { transform: "translateY(0) scale(1)", opacity: 1 },
            ],
            { duration: 440, easing: spring },
          ).catch(() => {})
          await wait(850)
        }
        // Cap-level systems may have no next band; never spin on an end bound.
        if (current === band.end_xp && !nextBand && current < target) {
          current = target
          frame({ phase: "impact", meter: meterAt(current) })
        }
      }
      await wait(180)
    }
    frame({
      phase: "done",
      meter: {
        total: after.total_xp,
        level: after.level,
        value: after.level_xp,
        cost: after.next_level_xp,
        percent: after.progress_pct,
      },
    })
    // Infinite drift remains alive for the final frame and belongs to the signal.
  } catch (error) {
    if (!signal.aborted) throw error
  }
}
