# Overwolf QA handoff — Companion 0.5.2-alpha.7

## Candidate

- Runtime: `0.5.2-alpha.7`; manifest: `0.5.2.7`; Backend: `0.10.1-alpha.9`.
- Game: Deadlock `24482`; minimum Overwolf `0.305.0.9`; minimum GEP `311.0.0`.
- Hotkey default: `Ctrl+Shift+C`; actual binding reads dynamically from Overwolf Settings.
- Overlay: input-pass-through, resizable, bounded to game, user-invoked, auto-minimizes after 6.5 sec.
- Ads: one `OwAd` desktop-HQ `400×60` container, additionally gated by the
  server feature `desktop_ads_v1`. Production default is OFF until dedicated
  Overwolf ad QA. Not present in overlay or during the entire Deadlock process lifecycle.

## Reviewer walkthrough

1. Verify packed OPK checksum, install the OPK, launch from dock and confirm the Desktop window is visible.
2. Check FTUE: product explanation, pairing, privacy and actual hotkey label. No ad should appear in FTUE.
3. Pair through the official site: no production credentials live in the OPK.
4. HQ: server status, profile and all three mode boards appear from the server. During the dedicated ad pass, enable `COMPANION_ADS_ENABLED=true`; the desktop ad rail may initialize only after pair + HQ + a fresh confirmation that Deadlock is not running. A no-fill/disabled state is not a product error.
5. Contracts: select 1–3 server options and lock them. Restart Companion and confirm the same server Active Case persists.
6. Start each Deadlock mode independently. Ensure unknown mode fails closed and live values are always marked `PROVISIONAL`.
7. Press the current hotkey during a safe visual moment. Check the rounded overlay, input pass-through, hover dodge, progress motion and selected-contract focus. Press again to hide; then reopen and verify automatic minimize near 6.5 sec.
8. Rebind the hotkey in Overwolf Settings. Without relaunch, verify Desktop, FTUE and Overlay all show the new binding. Test `UNASSIGNED` too.
9. Complete/fail a contract. The overlay burst must only say/mean provisional. Wait for server refresh: Debrief must show authoritative evaluator status, exact match ID and actually granted XP.
10. Start Deadlock, move through lobby/loading/game/post-game, then close it: ensure the Desktop ad slot stays destroyed for the entire process lifetime and never appears in overlay.

## Required Windows matrix

- 1366×720 @100%, 1366×768 @100%, 1920×1080 @125%, 3840×2160 @150%;
- fullscreen/windowed, Alt+Tab out/in, mid-game OPK install, desktop launch/exit/relaunch;
- offline/reconnect, changed hotkey, all three modes, long/short contract names, 1/2/3 selected contracts;
- CPU/RAM/network observation; final frozen OPK antivirus/VirusTotal.

## Submission stop conditions

- Overlay covers a critical Deadlock HUD element or remains visible longer than expected.
- Any ad appears while Deadlock is running, in overlay, FTUE, pairing, dialog, error/empty page or without adjacent HQ content.
- Client reports local completion/XP instead of server result.
- A real mode maps to a wrong board, GEP value is fabricated, or hotkey fails after rebind.

If one occurs, stop and fix before submitting; do not explain it away in QA notes.
