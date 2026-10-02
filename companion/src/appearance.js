/* Presentation preferences only. No account, telemetry, queue or game API access. */
(function attachAppearance(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCAppearance = api
  if (root?.document) api.initialize(root)
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const KEY = 'dc.appearance.v1'
  const THEMES = ['system', 'dark', 'light', 'black', 'custom']
  function normalize(value) {
    return {
      version: 1,
      theme: THEMES.includes(value?.theme) ? value.theme : 'dark',
      motion: value?.motion === 'reduced' ? 'reduced' : 'system',
    }
  }
  function read(storage) {
    try { return normalize(JSON.parse(storage?.getItem(KEY) || 'null')) } catch (_) { return normalize(null) }
  }
  function write(value, storage) {
    try {
      if (!storage?.setItem) return false
      storage.setItem(KEY, JSON.stringify(normalize(value)))
      return true
    } catch (_) { return false }
  }
  function resolve(value, system = {}) {
    const state = normalize(value)
    return {
      theme: state.theme === 'system' ? (system.dark === false ? 'light' : 'dark') : state.theme,
      reduced: state.motion === 'reduced' || system.reduced === true,
    }
  }
  function apply(value, doc, system) {
    const state = normalize(value)
    const resolved = resolve(state, system)
    doc.documentElement.setAttribute('data-theme', resolved.theme)
    doc.documentElement.setAttribute('data-reduced-motion', String(resolved.reduced))
    for (const button of doc.querySelectorAll('[data-appearance-theme]')) {
      button.setAttribute('aria-pressed', String(button.dataset.appearanceTheme === state.theme))
    }
    for (const button of doc.querySelectorAll('[data-appearance-motion]')) {
      button.setAttribute('aria-pressed', String(button.dataset.appearanceMotion === state.motion))
    }
    return resolved
  }
  function initialize(win) {
    let storage
    try { storage = win.localStorage } catch (_) { storage = null }
    let state = read(storage)
    const color = win.matchMedia?.('(prefers-color-scheme: dark)')
    const motion = win.matchMedia?.('(prefers-reduced-motion: reduce)')
    const render = () => apply(state, win.document, { dark: color?.matches, reduced: motion?.matches })
    const update = event => {
      const button = event.target.closest?.('[data-appearance-theme], [data-appearance-motion]')
      if (!button) return
      state = normalize({ ...state,
        ...(button.dataset.appearanceTheme ? { theme: button.dataset.appearanceTheme } : {}),
        ...(button.dataset.appearanceMotion ? { motion: button.dataset.appearanceMotion } : {}),
      })
      write(state, storage)
      render()
    }
    const sync = event => {
      if (event.key === KEY || event.key === null) { state = read(storage); render() }
    }
    win.document.addEventListener('click', update)
    win.document.addEventListener('DOMContentLoaded', render, { once: true })
    win.addEventListener('storage', sync)
    for (const media of [color, motion]) {
      if (media?.addEventListener) media.addEventListener('change', render)
      else media?.addListener?.(render)
    }
    render()
    return () => {
      win.document.removeEventListener('click', update)
      win.document.removeEventListener('DOMContentLoaded', render)
      win.removeEventListener('storage', sync)
      for (const media of [color, motion]) {
        if (media?.removeEventListener) media.removeEventListener('change', render)
        else media?.removeListener?.(render)
      }
    }
  }
  return { KEY, THEMES, normalize, read, write, resolve, apply, initialize }
})
