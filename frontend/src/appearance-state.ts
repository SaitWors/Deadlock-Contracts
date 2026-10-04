export type ThemeMode = "system" | "light" | "dark" | "black" | "custom"
export type Appearance = { theme: ThemeMode; accent: string; radius: number; motion: boolean }
export const APPEARANCE_KEY = "dc.ui.appearance"
export const defaultAppearance: Appearance = {
  theme: "dark",
  accent: "#d6a2d1",
  radius: 22,
  motion: true,
}
export const themeModes: ThemeMode[] = ["system", "light", "dark", "black", "custom"]

export function normalizeAppearance(value: unknown): Appearance {
  const p = value && typeof value === "object" ? (value as Partial<Appearance>) : {}
  return {
    theme: themeModes.includes(p.theme as ThemeMode) ? (p.theme as ThemeMode) : "dark",
    accent:
      typeof p.accent === "string" && /^#[a-f\d]{6}$/i.test(p.accent)
        ? p.accent
        : defaultAppearance.accent,
    radius:
      typeof p.radius === "number" && Number.isFinite(p.radius)
        ? Math.max(12, Math.min(28, p.radius))
        : 22,
    motion: p.motion !== false,
  }
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
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export function applyAppearance(
  p: Appearance,
  dark = window.matchMedia("(prefers-color-scheme: dark)").matches,
) {
  const actual = p.theme === "system" ? (dark ? "dark" : "light") : p.theme
  const root = document.documentElement
  root.dataset.theme = actual
  root.dataset.themeMode = p.theme
  root.dataset.motion = p.motion ? "full" : "reduced"
  root.style.colorScheme = actual === "light" ? "light" : "dark"
  root.style.setProperty("--ns-radius", `${p.radius}px`)
  root.style.setProperty("--ns-small", `${Math.min(14, Math.round(p.radius * 0.55))}px`)
  if (actual === "custom") {
    let accent = p.accent
    for (let i = 1; contrast(accent, "#403347") < 4.5 && i <= 20; i++) {
      accent =
        "#" +
        rgb(p.accent)
          .map((v) =>
            Math.round(v + ((255 - v) * i) / 20)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")
    }
    root.style.setProperty("--ns-accent", accent)
    root.style.setProperty("--ns-fill", p.accent)
    root.style.setProperty(
      "--ns-on-accent",
      contrast(p.accent, "#000000") >= contrast(p.accent, "#ffffff") ? "#000000" : "#ffffff",
    )
  } else {
    for (const key of ["--ns-accent", "--ns-fill", "--ns-on-accent"]) root.style.removeProperty(key)
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      { light: "#eee6d5", dark: "#181715", black: "#000000", custom: "#201921" }[actual],
    )
}
