import type { RevealProfile } from "./reveal-profiles"

type Renderer = typeof import("./reveal-fx/renderer")
let loading: Promise<Renderer | undefined> | undefined

export function prewarmRevealEffects() {
  loading ??= import("./reveal-fx/renderer").catch(() => {
    loading = undefined
    return undefined
  })
  return loading
}

export function createRevealEffects(layer: HTMLElement) {
  let renderer: ReturnType<Renderer["createRenderer"]> | undefined
  let generation = 0
  const timers = new Set<number>()

  return {
    play(
      cue: "hum" | "reveal" | "pack",
      anchor: HTMLElement,
      profile: RevealProfile,
      motion: "full" | "lite" | "reduced",
      subject?: HTMLElement,
    ) {
      if (motion === "reduced" || typeof requestAnimationFrame !== "function") return
      const anchorBounds = anchor.getBoundingClientRect()
      if (!anchorBounds.width || !anchorBounds.height) return
      const layerBounds = layer.getBoundingClientRect()
      const x = anchorBounds.left + anchorBounds.width / 2 - layerBounds.left
      const y =
        anchorBounds.top + anchorBounds.height * (cue === "pack" ? 0.18 : 0.5) - layerBounds.top
      const lite = motion === "lite"
      const hum = cue === "hum"
      const steps = lite
        ? hum
          ? profile.liteHum
          : profile.liteReveal
        : hum
          ? profile.hum
          : profile.reveal
      if (!steps.length) return

      const current = generation
      const started = performance.now()
      void prewarmRevealEffects().then((module) => {
        if (!module || current !== generation || !layer.isConnected) return
        renderer ??= module.createRenderer(layer)
        for (const step of steps) {
          const delay = step.delayMs - (performance.now() - started)
          // A cold import may outlive the visual beat. Do not bunch expired cues onto a later phase.
          if (delay < -220) continue
          const render = () => {
            if (current !== generation) return
            renderer?.play(step.name, {
              x,
              y,
              size: anchorBounds.width,
              ratio: anchorBounds.height / anchorBounds.width,
              tone: profile.color,
              accent: profile.secondary,
              intensity: profile.intensity * step.intensity,
              chargeMs: hum ? (profile.chargeMs - step.delayMs) * (lite ? 0.6 : 1) : undefined,
              lite,
              subject,
            })
          }
          if (delay <= 0) render()
          else {
            const timer = window.setTimeout(() => {
              timers.delete(timer)
              render()
            }, delay)
            timers.add(timer)
          }
        }
      })
    },
    clear() {
      generation++
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
      renderer?.clear()
    },
  }
}
