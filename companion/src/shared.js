// Alpha.9 compatibility adapter. All translations live in src/i18n.js.
(function attachShared(root) {
  const I18n = root.DCI18n
  if (!I18n) throw new Error('DCI18n must load before shared.js')
  function formatDateTime(value, options = {}) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat(I18n.language() === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', ...options }).format(date)
  }
  function localizeServerText(value) { return String(value || '') }
  root.DCShared = {
    STORAGE_KEY: I18n.PREF_KEY,
    SERVER_LANGUAGE_KEY: I18n.SERVER_LANGUAGE_KEY,
    copy: I18n.CATALOG,
    detectedLanguage: I18n.detectedLanguage,
    preference: I18n.preference,
    language: I18n.language,
    setPreference: I18n.setPreference,
    setServerLanguage: I18n.setServerLanguage,
    t: I18n.t,
    localizeServerText,
    formatNumber: I18n.formatNumber,
    formatDateTime,
  }
})(typeof window !== 'undefined' ? window : globalThis)
