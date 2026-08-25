import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const releaseFile = [path.join(root, 'release.json'), path.join(root, '..', 'release.json')].find(fs.existsSync)
if (!releaseFile) throw new Error('release.json is required beside the Companion root or its parent')
const releaseMetadata = JSON.parse(fs.readFileSync(releaseFile, 'utf8'))
const manifest = JSON.parse(read('manifest.json'))
const runtimeText = [
  'background.html', 'index.html', 'overlay.html',
  'src/background-engine.js', 'src/session-guard.js', 'src/desktop.js', 'src/desktop-ads.js', 'src/overlay.js', 'src/overlay-focus.js', 'src/product.js', 'src/shared.js',
  'styles/tokens.css', 'styles/app.css', 'styles/overlay.css',
].map(read).join('\n')

test('manifest preserves app identity and advances the QA build', () => {
  assert.equal(manifest.meta.name, 'Deadlock Contracts Companion')
  assert.equal(manifest.meta.author, 'Deadlock Contracts')
  assert.equal(manifest.meta.version, releaseMetadata.companion_manifest_version)
  assert.equal(manifest.meta['minimum-gep-version'], '311.0.0')
  assert.equal(manifest.data.start_window, 'background')
  assert.equal(manifest.data.process_name, 'Deadlock Contracts')
})

test('all user-visible release versions match release.json', () => {
  const version = releaseMetadata.companion_version
  assert.match(read('index.html'), new RegExp(`<b>${version.replaceAll('.', '\\.')}</b>`))
  assert.match(read('src/desktop.js'), new RegExp(`version: '${version.replaceAll('.', '\\.')}'`))
  assert.ok(read('THIRD_PARTY_NOTICES.txt').startsWith(`Deadlock Contracts Companion ${version}\n`))
})

test('release packaging publishes a deterministic CycloneDX file inventory', () => {
  const packaging = read('scripts/package-release.mjs')
  assert.match(packaging, /specVersion: '1\.6'/)
  assert.match(packaging, /Deadlock-Contracts-Companion-\$\{release\}\.cdx\.json/)
  assert.match(packaging, /alg: 'SHA-256'/)
  assert.match(packaging, /components: fileComponents/)
})

test('public product has a responsive desktop hub', () => {
  const desktop = manifest.data.windows.desktop
  assert.equal(desktop.desktop_only, true)
  assert.equal(desktop.native_window, true)
  assert.equal(desktop.use_os_windowing, true)
  assert.equal(desktop.resizable, true)
  assert.deepEqual(desktop.size, { width: 1200, height: 700 })
  assert.deepEqual(desktop.min_size, { width: 900, height: 620 })
  assert.ok(desktop.max_size.width >= desktop.size.width)
  assert.ok(desktop.max_size.height >= desktop.size.height)
})

test('overlay receives hover while remaining input-pass-through, resizable and bounded', () => {
  const overlay = manifest.data.windows.overlay
  assert.equal(overlay.in_game_only, true)
  assert.equal(overlay.clickthrough, false)
  assert.equal(overlay.style, 'inputPassThrough')
  assert.equal(overlay.ignore_keyboard_events, true)
  assert.equal(overlay.restrict_to_game_bounds, true)
  assert.equal(overlay.resizable, true)
  assert.deepEqual(overlay.size, { width: 420, height: 320 })
  assert.deepEqual(overlay.max_size, { width: 540, height: 360 })
})

test('Deadlock targeting, minimized launch and hotkey are explicit', () => {
  assert.deepEqual(manifest.data.game_targeting.game_ids, [24482])
  assert.deepEqual(manifest.data.game_events, [24482])
  const launch = manifest.data.launch_events.find(item => item.event === 'GameLaunch')
  assert.ok(launch)
  assert.equal(launch.start_minimized, true)
  assert.deepEqual(launch.event_data.game_ids, [24482])
  assert.equal(manifest.data.hotkeys.toggle_contract_overlay.default, 'Ctrl+Shift+C')
  assert.equal(manifest.data.hotkeys.toggle_contract_overlay.passthrough, true)
})

test('permissions stay least-privilege', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['Extensions', 'Streaming', 'Profile', 'GameInfo', 'Hotkeys'].sort())
})

test('runtime CSP is local-first and contains no remote executable assets', () => {
  for (const html of ['background.html', 'index.html', 'overlay.html']) {
    const text = read(html)
    assert.doesNotMatch(text, /<script[^>]+src=["']https?:\/\//i)
    assert.doesNotMatch(text, /style-src[^;]*unsafe-inline/i)
    assert.doesNotMatch(text, /script-src[^;]*unsafe-eval/i)
  }
  assert.doesNotMatch(read('styles/tokens.css'), /@import\s+url/i)
  assert.doesNotMatch(runtimeText, /fonts\.googleapis|fonts\.gstatic/i)
  assert.doesNotMatch(runtimeText, /style=["']/i)
})

test('contract runtime uses server IDs and exposes no settlement command', () => {
  const background = read('src/background-engine.js')
  assert.match(background, /\/api\/desktop\/v1\/bootstrap/)
  assert.match(background, /\/api\/desktop\/v1\/boards\/lock/)
  assert.match(background, /option_ids: ids/)
  assert.doesNotMatch(runtimeText, /sampleContracts|sampleHistory|LOCAL PREVIEW/)
  assert.doesNotMatch(runtimeText, /completion\s*[:=]|grantXp|rewardXp\s*=/i)
})

test('self-hosted font and license files are present', () => {
  const required = [
    'assets/fonts/inter-latin-400-normal.woff2',
    'assets/fonts/inter-cyrillic-400-normal.woff2',
    'assets/fonts/roboto-condensed-latin-800-normal.woff2',
    'assets/fonts/roboto-condensed-cyrillic-800-normal.woff2',
    'assets/fonts/cormorant-garamond-latin-400-normal.woff2',
    'assets/fonts/cormorant-garamond-cyrillic-400-normal.woff2',
    'licenses/Inter-OFL.txt', 'licenses/Roboto-Condensed-OFL.txt', 'licenses/Cormorant-Garamond-OFL.txt',
  ]
  for (const relative of required) assert.ok(fs.statSync(path.join(root, relative)).size > 0, relative)
})

test('adaptive profile and authoritative debrief surfaces are present', () => {
  const index = read('index.html')
  const desktop = read('src/desktop.js')
  const product = read('src/product.js')
  assert.match(index, /id="adaptiveIntel"/)
  assert.match(index, /id="view-debrief"/)
  assert.match(desktop, /latestVerdictGroup/)
  assert.match(desktop, /reward_granted_xp/)
  assert.match(desktop, /adaptive_profiles_v1/)
  assert.match(desktop, /debrief_v1/)
  assert.match(product, /adaptive_profiles/)
  assert.match(product, /latest_evaluation/)
})

test('hotkey reminders follow Overwolf settings changes without relaunch', () => {
  const background = read('src/background-engine.js')
  const desktop = read('src/desktop.js')
  const index = read('index.html')
  const overlay = read('overlay.html')
  assert.match(background, /overwolf\.settings\.hotkeys\.get/)
  assert.match(background, /hotkeys\.onChanged\.addListener/)
  assert.match(background, /hotkey_binding/)
  assert.match(background, /UNASSIGNED/)
  assert.match(desktop, /refreshHotkeyBinding/)
  assert.match(index, /id="ftueHotkey"/)
  assert.match(overlay, /id="overlayHotkey"/)
  assert.doesNotMatch(index, /data-i18n="ftueThree"/)
})

test('post-match product refresh is bounded and does not add client settlement authority', () => {
  const background = read('src/background-engine.js')
  assert.match(background, /POST_MATCH_PRODUCT_REFRESH_MS = \[2500, 8000, 20000, 45000, 90000\]/)
  assert.match(background, /schedulePostMatchProductRefresh\(payload\.match_id, payload\.session_id\)/)
  assert.doesNotMatch(background, /grantXp|setCompleted|settleContract/i)
})

test('launcher icon contains exactly the required Overwolf ICO layers and stays small', () => {
  const file = path.join(root, manifest.meta.launcher_icon)
  const buffer = fs.readFileSync(file)
  assert.ok(buffer.length < 150 * 1024)
  assert.equal(buffer.readUInt16LE(0), 0)
  assert.equal(buffer.readUInt16LE(2), 1)
  const count = buffer.readUInt16LE(4)
  const sizes = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    sizes.push(`${buffer[offset] || 256}x${buffer[offset + 1] || 256}`)
  }
  assert.deepEqual(sizes.sort(), ['16x16', '256x256', '32x32', '48x48'].sort())
})


test('overlay is single-focus, mode-strict and includes 3 second activity routing plus hover dodge', () => {
  const overlay = read('overlay.html')
  const source = read('src/overlay.js')
  const model = read('src/overlay-focus.js')
  const css = read('styles/overlay.css')
  assert.match(overlay, /id="overlayFocus"/)
  assert.match(overlay, /id="overlayHoverSensor"/)
  assert.doesNotMatch(overlay, /overlayCases/)
  assert.match(source, /strictActiveCase/)
  assert.match(source, /switchDelayMs: 3000/)
  assert.match(model, /SWITCH_DELAY_MS = 3000/)
  assert.match(css, /overlay-dodge/)
  assert.match(css, /transition: width \.68s/)
  assert.match(overlay, /completion-burst/)
  assert.match(css, /border-radius: 18px/)
})

test('hotkey overlay is temporary and can be dismissed without blocking input', () => {
  const background = read('src/background-engine.js')
  assert.match(background, /const OVERLAY_AUTO_HIDE_MS = 6500/)
  assert.match(background, /function scheduleOverlayAutoHide\(\)/)
  assert.match(background, /dismissOverlay\('auto_hide'\)/)
  assert.match(background, /auto_hide_ms/)
})

test('Overwolf-managed advertising is desktop-only, safe-moment gated and uses a supported slot', () => {
  const index = read('index.html')
  const desktop = read('src/desktop.js')
  const ads = read('src/desktop-ads.js')
  const css = read('styles/app.css')
  assert.match(index, /id="desktopAdRail"/)
  assert.match(index, /id="desktopAdContainer"[^>]*>\s*<\/div>/)
  assert.match(index, /script-src 'self' https:\/\/content\.overwolf\.com/)
  assert.match(desktop, /isSafeDesktopAdMoment/)
  assert.match(desktop, /snapshot\.phase/)
  assert.match(desktop, /game_state_confirmed/)
  assert.match(desktop, /observationFresh/)
  assert.match(desktop, /if \(snapshot\.game_running\) return false/)
  assert.doesNotMatch(desktop, /\['Init', 'WaitingForPlayersToJoin', 'PreGameWait', 'PostGame', 'LoadingScreen'\]/)
  assert.match(desktop, /modalIsClosed/)
  assert.match(desktop, /productReady/)
  assert.match(desktop, /serverAllowsAds/)
  assert.match(desktop, /desktop_ads_v1/)
  assert.match(ads, /https:\/\/content\.overwolf\.com\/libs\/ads\/latest\/owads\.min\.js/)
  assert.match(ads, /const CONTAINER_ID = 'dc_400x60_desktop_b'/)
  assert.match(ads, /width: 400, height: 60/)
  assert.match(ads, /new window\.OwAd/)
  assert.match(ads, /shutdown/)
  assert.doesNotMatch(ads, /<iframe\b/i)
  assert.match(css, /\.desktop-ad-stage[^}]*background: transparent/s)
  assert.match(css, /\.overwolf-ad-container[^}]*min-height: 60px/s)
})

test('runtime snapshots and diagnostics are privacy bounded', () => {
  const background = read('src/background-engine.js')
  const overlay = read('src/overlay.js')
  assert.match(background, /function sanitizeDiagnostic\(/)
  assert.match(background, /ROSTER_REDACTED/)
  assert.match(background, /STEAM_ID_REDACTED/)
  assert.match(background, /function overlaySnapshot\(\)/)
  assert.doesNotMatch(background, /logs: logLines\.slice/)
  assert.match(overlay, /getOverlaySnapshot/)
})

test('GEP feature registration is bounded, jittered and exposed fail-closed', () => {
  const background = read('src/background-engine.js')
  const desktop = read('src/desktop.js')
  assert.match(background, /FEATURE_RETRY_LIMIT/)
  assert.match(background, /FEATURE_RETRY_MAX_MS/)
  assert.match(background, /FEATURE_RECOVERY_MS/)
  assert.match(background, /Math\.random\(\)/)
  assert.match(background, /gep_feature_health/)
  assert.match(desktop, /gep_feature_health\?\.status === 'DEGRADED'/)
})

test('minimum-version rejection keeps pairing and queued data recoverable', () => {
  const background = read('src/background-engine.js')
  assert.match(background, /error\?\.status === 426/)
  assert.match(background, /x-minimum-companion-version/)
  assert.match(background, /Pairing and queued match data were kept/)
})

test('match transitions clear match-scoped evidence before opening a new session', () => {
  const background = read('src/background-engine.js')
  assert.match(background, /function resetMatchScopedState\(\)/)
  assert.match(background, /if \(changedMatch \|\| leavingFinalizedMatch\) resetMatchScopedState\(\)/)
  assert.match(background, /state\.matchOutcome = null/)
  assert.match(background, /state\.matchClockS = null/)
})

test('disconnect preserves pairing when uploads or server revocation are unacknowledged', () => {
  const background = read('src/background-engine.js')
  assert.match(background, /await flushQueue\(\{ force: true \}\)/)
  assert.match(background, /Disconnect paused:/)
  assert.match(background, /Pairing and queued data were kept/)
})

test('evidence v7 distinguishes real match_outcome info updates from cached getInfo labels', () => {
  const background = read('src/background-engine.js')
  assert.match(background, /EVIDENCE_SCHEMA_VERSION = 7/)
  assert.match(background, /function extractMatchInfo\(mi, source = 'get_info'\)/)
  assert.match(background, /applyMatchOutcome\(mi\.match_outcome, source\)/)
  assert.match(background, /function classifyInfoSource\(result\)/)
  assert.match(background, /const source = classifyInfoSource\(result\)/)
  assert.match(background, /extractMatchInfo\(res\.match_info, source\)/)
  assert.match(background, /applyMatchOutcome\(value, 'info_update'\)/)
  assert.match(background, /source === 'info_update' && state\.matchId/)
  assert.match(background, /state\.matchOutcomeEventAt = nowIso\(\)/)
  assert.match(background, /state\.matchOutcomeEventMatchId = Number\(state\.matchId\)/)
  assert.match(background, /match_outcome_event_at:/)
  assert.match(background, /match_outcome_event_match_id:/)
})


test('overlay hidden elements cannot be resurrected by display grid rules', () => {
  const css = read('styles/overlay.css')

  assert.match(
    css,
    /\[hidden\]\s*\{[^}]*display:\s*none\s*!important\s*;/s,
  )
})
