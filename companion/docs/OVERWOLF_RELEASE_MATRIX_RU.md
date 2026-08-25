# Overwolf release matrix — 0.5.2-alpha.7

Сверено с официальной документацией Overwolf 2026-08-25. Статус `static PASS` означает проверку исходника/архива, а не проход QA на реальном клиенте.

| Требование | Реализация alpha.7 | Статус |
|---|---|---:|
| Видимое Desktop окно | native, desktop-only, 1200×700, min 900×620 | static PASS |
| Background + GameLaunch | `background`, `start_minimized=true`, Deadlock `24482` | static PASS |
| Контракты | server boards → lock `option_ids` → Active Case → server Debrief/XP | automated/static PASS |
| Горячая клавиша | default + `get/onChanged/onPressed` Overwolf API | automated/static PASS; runtime OPEN |
| Overlay | in-game only, input pass-through, resize/bounds, manual + 6.5-sec auto-hide | static PASS; placement/runtime OPEN |
| Overlay motion | progress/switch/completion animation + reduced-motion fallback | static PASS; visual OPEN |
| Реклама | один OwAd `400×60`, Desktop HQ only, transparent parent, server kill switch default OFF | static PASS; ad QA/serving OPEN |
| Ads timing | не создаётся, пока процесс Deadlock запущен; также отсутствует в FTUE, pairing, dialogs, overlay | automated/static PASS; runtime OPEN |
| Ads permissions | Extensions, Streaming, Profile, GameInfo, Hotkeys | static PASS |
| CSP | self-hosted UI; exact official `content.overwolf.com` allowlist для SDK | static PASS |
| No client settlement | Companion не создаёт completion / reward / XP | automated/static PASS |
| OPK | manifest в root, normal compression, SHA-256 | packaging gate |
| Icons | PNG 256×256 / size gates; ICO 16/32/48/256 | static PASS |
| Manifest schema | local fields checked | official schema validation OPEN |
| DPI/resolution matrix | 1366×720, 1366×768, 1080p@125, 4K@150 | Windows OPEN |
| Gameplay focus | fullscreen/windowed/Alt+Tab/mid-game install | Windows OPEN |
| Real GEP | Standard, Ranked, Street Brawl with frozen OPK | Deadlock OPEN |
| Security/performance | offline/reconnect, CPU/RAM/network, AV | Windows OPEN |
| Store / DevRel | listing, policy review, ad enablement | Overwolf OPEN |

## Нельзя честно отметить PASS до ручного QA

Наличие whitelist и успешная OPK install-проверка не означают, что приложение уже approved. Перед submit обязательно выполнить manual items. Реальная выдача рекламы ожидается только после того, как Overwolf завершит свои ad tests и включит serving.
