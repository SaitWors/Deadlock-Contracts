# Alpha.9 QA matrix

## Automated gates
- `npm run release:check`
- menu/lobby close -> 0 final
- mid-match stop without terminal proof -> INTERRUPTED
- match_end/PostGame -> one correlated final
- immutable final snapshot
- start/phase/final causal ordering
- 4xx poison item does not block another session
- 401 only clears auth; 422 does not
- local final idempotency
- bootstrap schema 1 production compatibility
- strict heartbeat v1 projection
- RU/EN logical fingerprints
- lte/eq/win progress semantics
- storage checksum/read-back/quota errors

## Required manual Windows QA before OPK
1. Fresh unpacked install in Overwolf developer mode.
2. Pair account against `https://deadlock-contracts.online`.
3. Verify production bootstrap loads all three boards and RU/EN objectives remain semantically identical.
4. Close Deadlock from menu/lobby: no contract final, no attempt consumed.
5. Full real match: match_start, match_clock, match_id, match_end; exactly one final and server debrief.
6. Disconnect network mid-match and reconnect: queue survives and preserves order.
7. Ctrl+Shift+C open/close; hotkey rebind; fullscreen/borderless/windowed; Alt+Tab; second monitor if available.
8. 100/125/150% DPI, overlay presets, auto-hide Never/5/10/30.
9. Desktop X hides only; explicit Exit shows queue state and checkpoints before closing.
10. Pairing errors, force local sign-out, revoke/disconnect, clear cache, export pending uploads.
11. Ads remain disabled unless production exposes `desktop_ads_v1`.
12. After source ZIP is accepted, build OPK separately, validate manifest, install and VirusTotal scan.
