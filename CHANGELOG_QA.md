# Companion QA changelog

## 0.5.2-alpha.21

- Resume browser pairing after a Companion restart. Browser approval uses the signed-in Steam account, and the client stores its short-lived verifier in Overwolf user-encrypted storage.
- Close browser requests on cancellation, expiry or the first authenticated heartbeat after claim. Allow the requesting device to recover the same credential if the claim response was lost. Expire unused device credentials after the configured idle period.
- Register the running client version before the hello request. Require real heartbeat and bootstrap responses before displaying a connected state. Show separate recovery messages for network errors, expired credentials and incompatible versions.
- Offer English and Russian on the pairing page, carry the explicit preference through Steam and default clean Companion installations to English.
- Gate both official Overwolf ad slots on fresh data in Overview or Contracts. Tear down slots on modal, screen or window transitions. Package a separate build for isolated ad QA.
- Serialize desktop window operations, restore Dock focus, use the documented monitor permission, and recover a window after a display change. Keep hotkey reassignment inline and refresh the actual native binding.
- Preserve native contract selection and make retries of the same lock request return the existing server receipt. Give long status messages their own row so they cannot cover the current view. Improve wrapping in dialogs.
- Open an optional anonymous uninstall survey with a fixed set of reasons, an optional comment and a skip action.
- Build a single-root OPK with aligned release metadata, hashes and an inventory of bundled files. Keep browser preview fixtures in source only.

## Included alpha.19 and alpha.20 work

The PR also carries the two previously local QA commits. They added the native contract and pairing interface, positioned the Studio Plus rails outside scrolling, used native maximize/restore, and replaced the Dock artwork with the rounded color and gray binaries. The release keeps the current website style and Telegram support links.
