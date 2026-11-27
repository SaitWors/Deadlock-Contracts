import { createParticleField } from "./particles"
import { effectLibrary, type EffectName } from "./library"
import type { EffectStage } from "./stage"
import { runTimeline } from "./timeline"
import "./styles.css"

type EffectOptions = {
  x: number
  y: number
  size: number
  ratio: number
  tone: string
  accent: string
  intensity: number
  lite: boolean
  chargeMs?: number
}

export function createRenderer(layer: HTMLElement) {
  let field: ReturnType<typeof createParticleField> | undefined
  const runs = new Set<() => void>()
  const clearParticles = () => {
    field?.destroy()
    field = undefined
  }

  function play(name: EffectName, options: EffectOptions) {
    const effect = effectLibrary.get(name)
    if (!effect) return

    const { x, y, size, ratio, tone, accent, intensity, lite, chargeMs } = options
    const render = Math.min(1, (lite ? 1.25 : 2) / (window.devicePixelRatio || 1))
    const root = document.createElement("span")
    root.className = "rco-fx-play"
    root.dataset.effect = effect.name
    if (ratio < 1) root.dataset.wide = "true"
    root.style.opacity = String(intensity)
    for (const [property, value] of Object.entries({
      "--fx-x": `${x}px`,
      "--fx-y": `${y}px`,
      "--fx-size": `${size * render}px`,
      "--fx-zoom": String(1 / render),
      "--fx-ratio": String(ratio),
      "--fx-tone": tone,
      "--fx-accent": accent,
    })) {
      root.style.setProperty(property, value)
    }
    layer.append(root)

    const stage: EffectStage = {
      root,
      emit(group) {
        const density = Math.max(0.18, intensity * (lite ? 0.43 : 0.85))
        const remaining = (lite ? 44 : 100) - (field?.count() ?? 0)
        if (remaining <= 0) return
        const visible = group
          .filter((_, index) => (index * 0.618) % 1 < density)
          .slice(0, remaining)
        if (!visible.length) return
        for (const particle of visible) particle.alpha *= intensity
        field ??= createParticleField(layer, lite ? 1.25 : 2, clearParticles)
        field.emit(visible)
      },
      x,
      y,
      ratio,
      tone,
      scale: size / 300,
      unit: size * render,
      width: layer.clientWidth,
      height: layer.clientHeight,
      chargeSeconds: chargeMs ? chargeMs / 1000 : undefined,
      random: Math.random,
    }
    const timeScale =
      name === "patron-seal" || (name === "cracks" && chargeMs)
        ? 1
        : chargeMs
          ? Math.min(1, Math.max(0.16, (chargeMs + 180) / (effect.seconds * 1000)))
          : lite
            ? 0.65
            : 0.8
    let cancel: (() => void) | undefined
    const dispose = () => {
      cancel?.()
      root.remove()
      runs.delete(dispose)
    }
    try {
      cancel = runTimeline((tl) => effect.play(stage, tl), effect.seconds, timeScale, dispose)
      runs.add(dispose)
    } catch {
      dispose()
    }
  }

  return {
    play,
    clear() {
      for (const dispose of runs) dispose()
      clearParticles()
    },
  }
}
