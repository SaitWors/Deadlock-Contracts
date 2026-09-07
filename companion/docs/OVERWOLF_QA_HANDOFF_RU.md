# Overwolf QA handoff — Deadlock Contracts Companion

## Candidate identity

In a QA bundle, use `CANDIDATE.json` for the product version, manifest
version, OPK filename and SHA-256. In a source checkout, use
`companion/release.json` and the packaged `manifest.json`.
Record the actual backend version and feature flags used for the test.
The configured compatibility target is not evidence of a live server test.

The current manifest targets Deadlock `24482`, minimum Overwolf `0.305.0.9`
and minimum GEP `311.0.0`. The default hotkey is `Ctrl+Shift+C`; the active
binding must be read from Overwolf Settings.

The current overlay is non-resizable in the manifest. Check mouse and
keyboard focus in the actual client; an old report's input-pass-through
claim is not a runtime result. Auto-hide defaults to 10 seconds, with
Never / 5 / 10 / 30 second settings. Hover dodge was removed.

## Reviewer walkthrough

1. Verify the OPK checksum, install that file, launch from the dock and
   confirm that the Desktop window is visible. Record Windows, Overwolf,
   GEP, game version, display resolution and scaling.
2. Check FTUE, pairing, privacy links and the actual hotkey label. Pair on
   the official site and confirm that the correct account and server
   boards appear. Check invalid, expired and revoked pairing.
3. Select 1–3 server options and sign the contracts. Restart Companion
   and confirm that the same server Active Case persists. Test when
   Deadlock is open as well as when it is closed.
4. Test each supported mode separately. Unknown mode and missing GEP
   facts must produce an explicit unavailable/waiting state. Live
   progress must not be presented as a server verdict or granted XP.
5. Check the overlay with and without selected contracts. Verify game
   HUD visibility, positioning, keyboard focus, hotkey toggle and all
   auto-hide settings, including Never. Rebind the hotkey without
   relaunching and test the unassigned state.
6. Play a real match. Check a normal finish, immediate Exit after
   `match_end`, restart during the final-data grace period, network loss
   followed by reconnect, and two consecutive matches. Closing the
   game in a lobby must not be treated as a scoring match finish.
7. Confirm that the final result uses the correct Match ID and that
   displayed awarded XP matches the server result. Record whether the
   server enabled GEP settlement for this account; results from a
   disabled feature do not verify its enabled path.
8. Check minimize, close, explicit Exit, fullscreen / borderless /
   windowed, Alt+Tab and installation while the game is running.
9. Check RU/EN, long conditions, 1/2/3 selected contracts, offline state
   and recovery messages. Observe CPU, RAM and network use.
10. Ads remain subject to the server feature `desktop_ads_v1`. In the
    dedicated ad test, check that the Desktop slot is absent throughout
    the Deadlock process lifetime and in overlay, FTUE, pairing,
    dialogs and error/empty states. A disabled/no-fill state does not
    confirm actual ad serving. Record the tested setting and result.

## Windows matrix and evidence

- 1366×720 @100%, 1366×768 @100%, 1920×1080 @125%, 3840×2160 @150%.
- Fullscreen / borderless / windowed; Alt+Tab and second monitor if used.
- All supported modes, hotkey rebind/conflict/unassigned, offline/reconnect.
- Installation and antivirus checks for the exact frozen OPK.

Attach observations, logs and screenshots to the OPK SHA-256 and test
environment. Record untested cases as NOT RUN. Automatic package checks
and an earlier release's QA report do not fill in this matrix.

Wrong match correlation, duplicate/lost final delivery, client-awarded XP,
focus interference, unreadable critical UI or ads in gameplay require a
reproducible defect report and another test after the fix.

Official references:

- https://dev.overwolf.com/ow-native/guides/test-your-app/how-to-test-your-app
- https://dev.overwolf.com/ow-native/getting-started/release-your-app/
