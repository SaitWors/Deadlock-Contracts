import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
const errors = []
const warnings = []
const expectedRuntimeVersion = '0.5.2-alpha.4'
const expectedManifestVersion = '0.5.2.4'

const requiredMeta = ['name', 'author', 'version', 'minimum-overwolf-version', 'minimum-gep-version', 'description', 'dock_button_title', 'icon', 'icon_gray', 'launcher_icon', 'window_icon']
for (const key of requiredMeta) if (!manifest.meta?.[key]) errors.push(`manifest.meta.${key} is required`)
if (manifest.meta?.name !== 'Deadlock Contracts Companion') errors.push('manifest name changed; this would change the app UID')
if (manifest.meta?.author !== 'Deadlock Contracts') errors.push('manifest author changed; this would change the app UID')
if (manifest.meta?.version !== expectedManifestVersion) errors.push(`manifest version must be ${expectedManifestVersion}`)
if (manifest.meta?.['minimum-gep-version'] !== '311.0.0') errors.push('minimum GEP must remain 311.0.0 for winning_team support')
if (String(manifest.meta?.dock_button_title || '').length > 18) errors.push('dock_button_title exceeds 18 characters')
if (String(manifest.meta?.description || '').length > 180) errors.push('description exceeds 180 characters')
if (!/^\d+(\.\d+){0,3}$/.test(String(manifest.meta?.version || ''))) errors.push('manifest version must be numeric')
if (manifest.data?.start_window !== 'background') errors.push('background controller must remain the start window')

const windows = manifest.data?.windows || {}
if (!windows.desktop?.desktop_only) errors.push('desktop window must be desktop_only')
if (!windows.desktop?.native_window) errors.push('desktop window must use native_window')
if (!windows.desktop?.resizable) errors.push('desktop window must be resizable')
if ((windows.desktop?.min_size?.width || 0) > 900 || (windows.desktop?.min_size?.height || 0) > 620) errors.push('desktop minimum size exceeds the supported 900x620 layout')
if (!windows.overlay?.in_game_only) errors.push('overlay must be in_game_only')
if (windows.overlay?.clickthrough !== false || windows.overlay?.style !== 'inputPassThrough' || !windows.overlay?.ignore_keyboard_events) errors.push('overlay must receive hover while passing input through to the game')
if (!windows.overlay?.resizable) errors.push('overlay must be resizable from Desktop settings')
if (!windows.overlay?.restrict_to_game_bounds) errors.push('overlay must stay inside game bounds')

const permissions = new Set(manifest.permissions || [])
const allowedPermissions = new Set(['Extensions', 'GameInfo', 'Hotkeys'])
for (const permission of permissions) if (!allowedPermissions.has(permission)) errors.push(`unexpected permission: ${permission}`)
for (const permission of allowedPermissions) if (!permissions.has(permission)) errors.push(`missing permission: ${permission}`)

const launch = (manifest.data?.launch_events || []).find(item => item.event === 'GameLaunch')
if (!launch?.start_minimized) errors.push('GameLaunch must remain start_minimized')
if (JSON.stringify(launch?.event_data?.game_ids) !== '[24482]') errors.push('GameLaunch must target Deadlock 24482')
if (manifest.data?.hotkeys?.toggle_contract_overlay?.default !== 'Ctrl+Shift+C') errors.push('overlay hotkey reminder and manifest default are out of sync')

const files = []
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file)
    else files.push(file)
  }
}
walk(root)

for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (/(^|\/)(\.env|secrets?|backups?)(\/|$)/i.test(relative)) errors.push(`secret/backup path must not ship: ${relative}`)
  if (/\.(pem|key|p12|pfx)$/i.test(relative)) errors.push(`private key material must not ship: ${relative}`)
  if (!/\.(js|mjs|html|css|json|md|txt)$/i.test(relative)) continue
  const text = fs.readFileSync(file, 'utf8')
  if (/postgres(?:ql)?:\/\//i.test(text)) errors.push(`database URL found in ${relative}`)
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(text)) errors.push(`private key found in ${relative}`)
  if (/deadlock_api_key\s*=|steam_web_api_key\s*=|admin_totp_secret\s*=/i.test(text)) errors.push(`server secret value pattern found in ${relative}`)
  if (/<script[^>]+src=["']https?:\/\//i.test(text)) errors.push(`remote script tag found in ${relative}`)
  if (relative.startsWith('src/') && /sampleContracts|sampleHistory|LOCAL PREVIEW/.test(text)) errors.push(`sample product data found in runtime: ${relative}`)
}

for (const htmlFile of ['background.html', 'index.html', 'overlay.html']) {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8')
  if (/style-src[^;]*unsafe-inline/i.test(html)) errors.push(`unsafe-inline styles enabled in ${htmlFile}`)
  if (/script-src[^;]*unsafe-eval/i.test(html)) errors.push(`unsafe-eval enabled in ${htmlFile}`)
}
const tokens = fs.readFileSync(path.join(root, 'styles/tokens.css'), 'utf8')
if (/@import\s+url/i.test(tokens) || /fonts\.(?:googleapis|gstatic)/i.test(tokens)) errors.push('remote font delivery is enabled')
const source = ['background-engine.js', 'session-guard.js', 'desktop.js', 'overlay.js', 'overlay-focus.js', 'product.js', 'shared.js'].map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n')
if (!source.includes(expectedRuntimeVersion)) errors.push(`runtime version ${expectedRuntimeVersion} is missing`)
if (!source.includes('/api/desktop/v1/bootstrap')) errors.push('Desktop API bootstrap route is missing')
if (/completion\s*[:=]|grantXp/i.test(source)) errors.push('client settlement authority pattern found in runtime')
if (/style=["']/.test(source)) errors.push('inline style found in generated runtime markup; strict CSP will block it')

function pngDimensions(file) {
  const buffer = fs.readFileSync(file)
  if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}
for (const key of ['icon', 'icon_gray', 'window_icon']) {
  const relative = manifest.meta?.[key]
  const file = relative ? path.join(root, relative) : ''
  if (!relative || !fs.existsSync(file)) {
    errors.push(`missing icon file: ${relative || key}`)
    continue
  }
  const dimensions = pngDimensions(file)
  if (!dimensions || dimensions.width !== 256 || dimensions.height !== 256) errors.push(`${relative} must be a 256x256 PNG`)
  if (fs.statSync(file).size >= 30 * 1024) errors.push(`${relative} must remain below 30 KB`)
}
const launcher = path.join(root, manifest.meta?.launcher_icon || '')
if (!manifest.meta?.launcher_icon || !fs.existsSync(launcher)) {
  errors.push('launcher ICO is missing')
} else {
  const buffer = fs.readFileSync(launcher)
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    errors.push('launcher ICO has an invalid header')
  } else {
    const count = buffer.readUInt16LE(4)
    const sizes = []
    for (let index = 0; index < count; index += 1) {
      const offset = 6 + index * 16
      if (offset + 16 > buffer.length) {
        errors.push('launcher ICO directory is truncated')
        break
      }
      sizes.push(`${buffer[offset] || 256}x${buffer[offset + 1] || 256}`)
    }
    const expected = ['16x16', '32x32', '48x48', '256x256']
    if (JSON.stringify(sizes.sort()) !== JSON.stringify(expected.sort())) errors.push(`launcher ICO layers must be exactly ${expected.join(', ')}; got ${sizes.join(', ')}`)
  }
  if (fs.statSync(launcher).size >= 150 * 1024) errors.push('launcher ICO must remain below 150 KB')
}

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const overlayHtml = fs.readFileSync(path.join(root, 'overlay.html'), 'utf8')
const backgroundSource = fs.readFileSync(path.join(root, 'src/background-engine.js'), 'utf8')
const productSource = fs.readFileSync(path.join(root, 'src/product.js'), 'utf8')
if (!indexHtml.includes('id="view-debrief"') || !indexHtml.includes('id="adaptiveIntel"')) errors.push('Adaptive Contracts / Debrief desktop surfaces are missing')
if (!indexHtml.includes('id="ftueHotkey"') || !overlayHtml.includes('id="overlayHotkey"')) errors.push('dynamic hotkey reminder surfaces are missing')
if (!overlayHtml.includes('id="overlayHoverSensor"') || !overlayHtml.includes('src/overlay-focus.js')) errors.push('activity-focused dodge overlay surface is missing')
if (!backgroundSource.includes('overwolf.settings.hotkeys.get') || !backgroundSource.includes('hotkeys.onChanged.addListener')) errors.push('hotkey binding must refresh from Overwolf settings without relaunch')
if (!backgroundSource.includes('POST_MATCH_PRODUCT_REFRESH_MS')) errors.push('bounded post-match product refresh policy is missing')
if (!productSource.includes("'player.object_damage': 'object_damage'")) errors.push('object damage provisional metric mapping is missing')
if (!productSource.includes("['WIN', 'VICTORY']") || !productSource.includes("['LOSS', 'DEFEAT']")) errors.push('Deadlock local victory/defeat mapping is incomplete')

if (warnings.length) {
  console.log('WARNINGS')
  for (const warning of warnings) console.log(`- ${warning}`)
}
if (errors.length) {
  console.error('RELEASE CHECK FAILED')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log('RELEASE CHECK PASSED')
console.log(`version=${manifest.meta.version} runtime=${expectedRuntimeVersion} permissions=${[...permissions].join(',')}`)
