import { createParticleField } from "./particles"
import { effectLibrary, type EffectName } from "./library"
import { channels, type EffectStage } from "./stage"
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
  subject?: HTMLElement
}

export function createRenderer(layer: HTMLElement) {
  let field: ReturnType<typeof createParticleField> | undefined
  const runs = new Set<() => void>()

  function play(name: EffectName, options: EffectOptions) {
    const effect = effectLibrary.get(name)
    if (!effect) return

    const { x, y, size, ratio, tone, accent, intensity, lite, chargeMs, subject } = options
    const render = Math.min(1, (lite ? 1.25 : 2) / (window.devicePixelRatio || 1))
    const root = document.createElement("span")
    root.className = "rco-fx-play"
    root.dataset.effect = effect.name
    root.setAttribute("aria-hidden", "true")
    root.style.opacity = String(intensity)
    for (const [property, value] of Object.entries({
      "--fx-x": `${x}px`,
      "--fx-y": `${y}px`,
      "--fx-size": `${size * render}px`,
      "--fx-cx": `${x * render}px`,
      "--fx-cy": `${y * render}px`,
      "--fx-zoom": String(1 / render),
      "--fx-ratio": String(ratio),
      "--fx-tone": tone,
      "--fx-accent": accent,
      "--fx-rgb": channels(tone).join(" "),
      "--fx-accent-rgb": channels(accent).join(" "),
    })) {
      root.style.setProperty(property, value)
    }
    layer.append(root)

    const particles = {
      emit: (group: Parameters<ReturnType<typeof createParticleField>["emit"]>[0]) => {
        const density = Math.max(0.18, intensity * (lite ? 0.43 : 0.85))
        const visible = group.filter((_, index) => (index * 0.618) % 1 < density)
        for (const particle of visible) particle.alpha *= intensity
        field ??= createParticleField(layer, true, lite ? 1.25 : 2)
        field.emit(visible)
      },
      clear: () => field?.clear(),
      destroy: () => field?.destroy(),
      count: () => field?.count() ?? 0,
    }
    const stage: EffectStage = {
      root,
      field: particles,
      x,
      y,
      size,
      ratio,
      tone,
      accent,
      scale: size / 300,
      unit: size * render,
      render,
      width: layer.clientWidth,
      height: layer.clientHeight,
      subject: subject ?? null,
      random: Math.random,
    }
    const timeScale = chargeMs
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
      field?.destroy()
      field = undefined
    },
  }
}
