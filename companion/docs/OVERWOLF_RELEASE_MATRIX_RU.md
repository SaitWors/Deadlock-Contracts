# Overwolf release matrix — 0.5.2-alpha.3

Сверено с официальной документацией Overwolf 2026-08-19.

| Требование | Реализация | Статус |
|---|---|---:|
| Видимое Desktop окно | Hub 1200×700 | PASS code/static |
| Responsive minimum | min 900×620 | PASS code/static |
| Background orchestrator | background start window | PASS code/static |
| Тихий GameLaunch | `start_minimized=true` | PASS code/static |
| Core flow | boards → lock → Active Case → Debrief/History/Profile | PASS automated logic |
| Game overlay | game-only, click/input pass-through | PASS static |
| Dynamic hotkey | manifest default + Overwolf `get/onChanged/onPressed` | PASS automated logic; RECHECK runtime |
| FTUE | pairing/flow/hotkey/privacy | PASS code; RECHECK runtime |
| Dedicated targeting | Deadlock `24482` | PASS |
| Minimum Overwolf | `0.305.0.9` | PASS current changelog check |
| Minimum GEP | `311.0.0` | PASS capability floor; current GEP newer |
| Least privilege | Extensions, GameInfo, Hotkeys | PASS |
| CSP / remote executable assets | local JS/CSS/fonts | PASS |
| Launcher ICO | only 16/32/48/256; <150 KB | PASS automated |
| Dock icons | PNG 256×256; size gate | PASS automated |
| Packed OPK checksum | SHA-256 | PASS packaging |
| Official current manifest schema | current official schema reviewed | RECHECK with fresh AJV before submit |
| 1366×720 / 1366×768 | real Windows/OW | OPEN |
| 1920×1080 @125% | real Windows/OW | OPEN |
| 3840×2160 @150% | real Windows/OW | OPEN |
| Fullscreen/windowed/Alt+Tab | real game | OPEN |
| Hotkey rebind without relaunch | real OW settings | OPEN |
| Mid-game install | packed OPK | OPEN |
| Offline/reconnect | real client/network | OPEN |
| Real Deadlock GEP | exact candidate | RECHECK |
| Performance CPU/RAM/network | real Windows | OPEN |
| Antivirus/VirusTotal | final OPK | OPEN |
| Appstore listing/reviewer access | developer console | OPEN |

## Почему visual matrix не отмечена PASS

Попытка автоматического screenshot/browser QA в sandbox была заблокирована политикой окружения Chromium (`ERR_BLOCKED_BY_ADMINISTRATOR`). Поэтому здесь нет фиктивного заявления, что Windows/Overwolf resolution matrix уже пройдена.

## Manifest schema note

Официальная Overwolf documentation по-прежнему ссылается на Draft-07 schema из `overwolf/community-gists`. Схема была просмотрена через официальный web source; fresh automated download из build sandbox не выполнился из-за DNS restriction. Перед submit обязательно повторить официальный AJV validator на машине с сетью.
