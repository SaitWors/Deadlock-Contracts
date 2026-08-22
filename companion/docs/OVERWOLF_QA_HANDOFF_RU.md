# Overwolf QA handoff — Companion 0.5.2-alpha.4

## Candidate

- Product: Deadlock Contracts Companion
- Runtime: `0.5.2-alpha.4`
- Manifest: `0.5.2.4`
- Backend: `0.10.1-alpha.8`
- Desktop API: `desktop.v1 / schema 1`
- Game: Deadlock / `24482`
- Default overlay hotkey: `Ctrl+Shift+C` (actual binding is read dynamically)
- Minimum Overwolf: `0.305.0.9`
- Minimum GEP: `311.0.0`

## Reviewer walkthrough

1. Packed OPK install. Manual/dock launch должен открыть видимое Desktop window.
2. FTUE: flow + privacy + actual current hotkey должны отображаться корректно.
3. Pairing: получить code на сайте → Connect. Никаких встроенных production credentials.
4. HQ: server online, profile и три boards.
5. Contracts: проверить Adaptive Intel для каждого режима. Cold-start должен честно показываться cold-start, без выдуманного baseline.
6. Открыть `WHY THIS CONTRACT?` на персонализированной карточке: sample/confidence/baseline/target должны совпадать с server payload.
7. Выбрать 1–3 server options → Lock Case. После restart должен остаться тот же server Active Case.
8. Запустить Deadlock в matching mode. Live progress обязан быть помечен `PROVISIONAL`.
9. Overlay: нажать текущий binding. Проверить input-pass-through и тот же Active Case.
10. В Overwolf Settings изменить hotkey. Без relaunch UI Companion должен показать новый binding, и новый hotkey должен работать. Unassign также должен отображаться как unassigned, а не старое значение.
11. Завершить матч. Client не должен объявлять verdict локально. Дождаться server refresh → Debrief.
12. Debrief: точный Match ID, evaluator status, фактически granted XP, retryable miss/VERIFYING semantics.
13. Проверить History и Profile progression после server settlement.
14. Отдельно сыграть/проверить STANDARD, RANKED, STREET_BRAWL. Future/unknown mode нельзя молча отобразить как Standard/Ranked.

## Required Overwolf matrix

Пройти на реальном Windows/Overwolf:

- 1366×720 @ 100%;
- 1366×768 @ 100%;
- 1920×1080 @ 125%;
- 2560×1440 @ 100% (project extension check);
- 3840×2160 @ 150%;
- fullscreen + windowed;
- Alt+Tab out/in;
- mid-game installation;
- desktop launch/exit/relaunch;
- offline/reconnect;
- changed hotkey functionality + UI without app relaunch;
- CPU/RAM/network observation;
- final packed OPK antivirus/VirusTotal.

## Failure expectations

- unpaired: no fake boards;
- `401`: local token cleared, re-pair required;
- incompatible API/schema: explicit server update state, no silent fallback;
- unknown mode: fail closed;
- missing server debrief/adaptive feature: hide/disable feature rather than fabricate data;
- provider delay: VERIFYING/DELAYED, not fake FAILED/COMPLETED;
- missing metric: unknown/unverifiable, not zero.
