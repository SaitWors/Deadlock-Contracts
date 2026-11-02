"use strict";

// Standalone, crawlable documents share the website's saved appearance contract.
(() => {
  const key = "dc.ui.appearance";
  const modes = ["system", "light", "dark", "black", "custom"];
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const controls = document.querySelectorAll("[data-document-theme]");
  function read() {
    let value;
    try { value = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    const p = value && typeof value === "object" ? value : {};
    return {
      theme: modes.includes(p.theme) ? p.theme : "dark",
      accent: typeof p.accent === "string" && /^#[a-f\d]{6}$/i.test(p.accent) ? p.accent : "#aec69b",
      radius: Number.isFinite(p.radius) ? Math.max(0, Math.min(8, p.radius)) : 4,
      motion: p.motion !== false,
    };
  }
  const rgb = (hex) => hex.match(/[a-f\d]{2}/gi).map((v) => parseInt(v, 16));
  const luminance = (hex) => rgb(hex).map((n) => {
    n /= 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  let preference = read();
  function apply() {
    const p = preference, root = document.documentElement;
    const theme = p.theme === "system" ? (system.matches ? "dark" : "light") : p.theme;
    root.dataset.theme = theme;
    root.dataset.themeMode = p.theme;
    root.dataset.motion = p.motion ? "full" : "reduced";
    root.style.colorScheme = theme === "light" ? "light" : "dark";
    root.style.setProperty("--ns-radius", `${p.radius}px`);
    root.style.setProperty("--ns-small", `${Math.min(4, Math.round(p.radius * .55))}px`);
    for (const name of ["--ns-accent", "--ns-fill", "--ns-on-accent"]) root.style.removeProperty(name);
    if (theme === "custom") {
      let accent = p.accent;
      for (let i = 1; contrast(accent, "#202821") < 4.5 && i <= 20; i++) {
        accent = "#" + rgb(p.accent).map((v) => Math.round(v + (255 - v) * i / 20).toString(16).padStart(2, "0")).join("");
      }
      root.style.setProperty("--ns-accent", accent);
      root.style.setProperty("--ns-fill", p.accent);
      root.style.setProperty("--ns-on-accent", contrast(p.accent, "#000000") >= contrast(p.accent, "#ffffff") ? "#000000" : "#ffffff");
    }
    controls.forEach((control) => { control.value = p.theme; });
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", {light:"#eeeee7", dark:"#0b0d0d", black:"#000000", custom:"#0b100d"}[theme]);
  }
  controls.forEach((control) => control.addEventListener("change", () => {
    if (!modes.includes(control.value)) return;
    preference = {...preference, theme: control.value};
    try { localStorage.setItem(key, JSON.stringify(preference)); } catch {}
    apply();
  }));
  system.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) { preference = read(); apply(); }
  });
  apply();
})();
