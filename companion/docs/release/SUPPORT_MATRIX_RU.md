# Alpha.9 support matrix

| Компонент | Alpha.9 |
|---|---|
| Product | Deadlock Contracts Companion |
| Runtime version | `0.5.2-alpha.13` |
| Manifest version | `0.5.2.13` |
| Framework | Overwolf Native WebApp |
| Game | Deadlock |
| Deadlock game ID | `24482` |
| Required GEP features | `gep_internal`, `game_info`, `match_info` |
| Minimum Overwolf | `0.305.0.9` |
| Minimum GEP | `311.0.0` |
| Languages | English / Russian / Auto + pseudo-locale test support |
| Backend verified against | `https://deadlock-contracts.online`, production web `0.10.1-alpha.10` snapshot |
| Production desktop API | `desktop.v1` |
| Production bootstrap schema | `1` (client also understands local/future schema `2`) |
| Local evidence schema | `8` |
| Production heartbeat | strict `companion-heartbeat.v1` projection |
| Overlay | input-pass-through, 440×280 preset base, non-resizable manifest window |
| Default overlay auto-hide | 10 s; Never/5/10/30 presets |
| Hotkey | `Ctrl+Shift+C`, rebind via Overwolf |
| Ads | Official OwAd, desktop-only, server-disabled for initial QA unless feature enabled |
| Storage | encrypted pending queue/lifecycle; bounded cache/queue; checksum/read-back |

## Manual runtime matrix required before OPK

- Windows supported by current Overwolf client.
- Deadlock fullscreen / borderless / windowed.
- 100% / 125% / 150% display scaling.
- Alt+Tab and, where available, second monitor.
- Fresh pairing, expired/invalid pairing, revoke, offline local sign-out.
- Online → offline → reconnect during a confirmed match.
- Menu/lobby close (must produce zero scoring final).
- Full real match (exactly one final after explicit/correlated terminal proof).
- Hotkey rebind/conflict/unassigned recovery.
- Overlay presets and all auto-hide values.
- Desktop minimize/×/explicit Exit lifecycle.
