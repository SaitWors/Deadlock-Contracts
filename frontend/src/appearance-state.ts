export type ThemeMode = "system" | "light" | "dark" | "black" | "custom"
export type MotionMode = "SYSTEM" | "FULL" | "OFF"
export type EffectsQuality = "AUTO" | "FULL" | "LITE"
export type Appearance = {
  theme: ThemeMode
  accent: string
  radius: number
  motion: MotionMode
  effectsQuality: EffectsQuality
  packSound: boolean
}
export const APPEARANCE_KEY = "dc.ui.appearance"
export const SYSTEM_MOTION_QUERY = "(prefers-reduced-motion: reduce)"
export const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)"
export const defaultAppearance: Appearance = {
  theme: "dark",
  accent: "#aec69b",
  radius: 4,
  motion: "SYSTEM",
  effectsQuality: "AUTO",
  packSound: false,
}
export const themeModes: ThemeMode[] = ["system", "light", "dark", "black", "custom"]

export function normalizeAppearance(value: unknown): Appearance {
  const p =
    value && typeof value === "object"
      ? (value as Partial<Omit<Appearance, "motion"> & { motion: unknown }>)
      : {}
  return {
    theme: themeModes.includes(p.theme as ThemeMode) ? (p.theme as ThemeMode) : "dark",
    accent:
      typeof p.accent === "string" && /^#[a-f\d]{6}$/i.test(p.accent)
        ? p.accent
        : defaultAppearance.accent,
    radius:
      typeof p.radius === "number" && Number.isFinite(p.radius)
        ? Math.max(0, Math.min(8, p.radius))
        : 4,
    // The former enabled setting still deferred to reduced motion on the device.
    motion:
      p.motion === false || p.motion === "OFF" ? "OFF" : p.motion === "FULL" ? "FULL" : "SYSTEM",
    effectsQuality:
      p.effectsQuality === "FULL" || p.effectsQuality === "LITE" ? p.effectsQuality : "AUTO",
    packSound: p.packSound === true,
  }
}
export function resolveReducedMotion(mode: MotionMode, systemReduced: boolean) {
  return mode === "OFF" || (mode === "SYSTEM" && systemReduced)
}

export function readAppearance(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "null"))
  } catch {
    return { ...defaultAppearance }
  }
}
function rgb(hex: string) {
  return hex.match(/[a-f\d]{2}/gi)!.map((v) => parseInt(v, 16))
}
function luminance(hex: string) {
  return rgb(hex)
    .map((x) => {
      x /= 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0)
}
const surfaceContrastBase = luminance("#1d2529") + 0.05

export function applyAppearance(
  p: Appearance,
  dark = window.matchMedia(SYSTEM_THEME_QUERY).matches,
  reduced = resolveReducedMotion(p.motion, window.matchMedia(SYSTEM_MOTION_QUERY).matches),
) {
  const actual = p.theme === "system" ? (dark ? "dark" : "light") : p.theme
  const { dataset, style } = document.documentElement
  dataset.theme = actual
  dataset.themeMode = p.theme
  dataset.motion = reduced ? "reduced" : "full"
  style.colorScheme = actual === "light" ? "light" : "dark"
  style.setProperty("--ns-radius", `${p.radius}px`)
  style.setProperty("--ns-small", `${Math.min(4, Math.round(p.radius * 0.55))}px`)
  if (actual === "custom") {
    const channels = rgb(p.accent)
    const fillContrastBase = luminance(p.accent) + 0.05
    let accent = p.accent
    // The elevated surface is too dark for a darker accent to reach 4.5:1.
    for (let i = 1; i <= 20 && (luminance(accent) + 0.05) / surfaceContrastBase < 4.5; i++) {
      accent =
        "#" +
        channels
          .map((v) =>
            Math.round(v + ((255 - v) * i) / 20)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")
    }
    style.setProperty("--ns-accent", accent)
    style.setProperty("--ns-fill", p.accent)
    style.setProperty(
      "--ns-on-accent",
      fillContrastBase / 0.05 >= 1.05 / fillContrastBase ? "#000000" : "#ffffff",
    )
  } else {
    for (const key of ["--ns-accent", "--ns-fill", "--ns-on-accent"]) style.removeProperty(key)
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      actual === "light" ? "#edf1f2" : actual === "black" ? "#000000" : "#0b0d0d",
    )
}
