// Isolated UI fixtures, never imported by production code or sent to a live API.
export const session = {
  authenticated: true,
  csrf_token: "qa-csrf",
  release: { version: "UI preview", modes: ["STANDARD", "RANKED", "STREET_BRAWL"] },
  user: {
    id: "board-preview",
    display_name: "Демо · QA",
    avatar_url: null,
    xp: 0,
    status: "ACTIVE",
    locale: "ru",
    timezone: "UTC",
    access_role: "PLAYER",
    badges: [],
    created_at: null,
    is_admin: false,
    is_staff: false,
    permissions: [],
    can_manage_roles: false,
  },
}

export function boardsPayload() {
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 8 * 3_600_000).toISOString()
  return {
    date: now.slice(0, 10),
    server_time: now,
    refresh: { free_per_day: 1, used: 0, remaining: 1, last_mode: null, reset_at: expires },
    boards: ["STANDARD", "RANKED", "STREET_BRAWL"].map((mode) => ({
      id: `qa-${mode}`,
      date: now.slice(0, 10),
      status: "OFFERED",
      game_match_mode: mode,
      generation: 1,
      locked_at: null,
      expires_at: expires,
      daily_reset_at: expires,
      case_expires_at: null,
      attempts_used: 0,
      max_attempts: 3,
      attempts_remaining: 3,
      provider_status: null,
      options: [
        ["COMBAT", "Уверенная атака", "Steady attack", "player.kills", 8, 40],
        ["SUPPORT", "Командная работа", "Teamwork", "player.assists", 12, 60],
        ["ECONOMY", "Запас душ", "Soul reserve", "player.net_worth.final", 25000, 50],
        ["COMBAT", "Сильный удар", "Strong strike", "player.kills", 12, 80],
        ["SUPPORT", "На подхвате", "Ready to assist", "player.assists", 8, 40],
        ["ECONOMY", "Дело с запасом", "A case in reserve", "player.net_worth.final", 35000, 70],
      ].map(([category, ru, en, metric, target, reward_xp], index) => ({
        id: `${mode}-${index}`,
        title: ru,
        title_i18n: { ru, en },
        description: "Изолированный пример для проверки интерфейса.",
        description_i18n: { ru: "Изолированный пример.", en: "Isolated preview fixture." },
        category,
        metric,
        target,
        operator: "gte",
        reward_xp,
        selected: false,
        status: "OFFERED",
        progress_current: null,
        explanation: null,
        bound_match_id: null,
        difficulty: index < 3 ? "LIGHT" : "FOCUSED",
        rarity: index < 3 ? "COMMON" : "UNCOMMON",
        drop_chance_pct: 20,
        conditions: [{ metric, target, operator: "gte" }],
      })),
    })),
  }
}

export function auxiliaryResponse(url) {
  if (url === "/api/me" || url === "/api/preferences") return session
  if (url.startsWith("/api/history")) return { cases: [], total: 0 }
  if (url === "/api/progression")
    return { level: 1, total_xp: 0, xp_to_next: 100, contracts_completed: 0, progress_pct: 0 }
  if (url === "/api/reviews/mine") return { items: [] }
  if (url === "/api/companion/status") return { device: null, devices: [] }
  if (url.startsWith("/api/archive/wallet")) return { balance: 0, currency: "ARCHIVE_TOKEN" }
  if (url.startsWith("/api/bureaus")) return { my_bureau: null, items: [] }
  if (url.startsWith("/api/announcements/active"))
    return { items: [], server_time: new Date().toISOString() }
  if (url.startsWith("/api/public/hero-votes")) return { enabled: false, heroes: [], items: [] }
  throw new Error(`Unexpected request: ${url}`)
}
