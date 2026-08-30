import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
const errors=[]
const json=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))
const release=json('release.json'), manifest=json('manifest.json'), pkg=json('package.json')
if(release.product_version!=='0.5.2-alpha.16')errors.push('release product_version mismatch')
if(release.manifest_version!=='0.5.2.16')errors.push('release manifest_version mismatch')
if(manifest.meta?.version!==release.manifest_version)errors.push('manifest version mismatch')
if(pkg.version!==release.product_version)errors.push('package version mismatch')
const notices=fs.readFileSync(path.join(root,'THIRD_PARTY_NOTICES.txt'),'utf8')
if(!notices.startsWith(`Deadlock Contracts Companion ${release.product_version}\n`))errors.push('third-party notices version mismatch')
const compat=fs.readFileSync(path.join(root,'src/server-compat.js'),'utf8')
if(!compat.includes(`PRODUCTION_WEB_VERSION = '${release.production_web_version}'`))errors.push('server compat target mismatch')
if(!manifest.permissions?.includes('Clipboard'))errors.push('Clipboard permission missing')
if(manifest.meta?.name!=='Deadlock Contracts Companion'||manifest.meta?.author!=='Deadlock Contracts')errors.push('manifest UID identity changed')
if(!manifest.data?.game_targeting?.game_ids?.includes(24482))errors.push('Deadlock game id missing')
for(const f of ['scripts/package-release.mjs','src/release-meta.js','src/i18n.js','src/schema.js','src/progress.js','src/storage.js','src/lifecycle-machine.js','src/upload-queue.js','src/health.js','src/server-compat.js','src/evidence.js','src/focus-selector.js','src/product.js','src/background-engine.js','src/desktop.js','src/overlay.js','schemas/bootstrap.v2.schema.json','schemas/evidence.v8.schema.json','fixtures/preview.json'])if(!fs.existsSync(path.join(root,f)))errors.push(`missing ${f}`)
const background=fs.readFileSync(path.join(root,'background.html'),'utf8')
const order=['release-meta.js','i18n.js','schema.js','progress.js','storage.js','lifecycle-machine.js','upload-queue.js','health.js','server-compat.js','evidence.js','focus-selector.js','product.js','background-engine.js']
let last=-1;for(const n of order){const at=background.indexOf(n);if(at<0)errors.push(`background missing ${n}`);if(at<last)errors.push(`background script order invalid at ${n}`);last=at}
if(/session-guard\.js|queue-policy\.js/.test(background))errors.push('legacy runtime module referenced')

const evidence=fs.readFileSync(path.join(root,'src/evidence.js'),'utf8')
if(!evidence.includes('MISSING_PARTIAL_UPDATE'))errors.push('partial GEP evidence preservation missing')
const focus=fs.readFileSync(path.join(root,'src/focus-selector.js'),'utf8')
if(!focus.includes('recent_activity'))errors.push('dynamic overlay focus selector missing')
const bg=fs.readFileSync(path.join(root,'src/background-engine.js'),'utf8')
for(const forbidden of ["getRunningGameInfo(","finishSession('game_stopped')","getInfo('match_ended')","game_detected_fallback"]){if(bg.includes(forbidden))errors.push(`forbidden Alpha.8 lifecycle pattern: ${forbidden}`)}
if(!bg.includes('getRunningGameInfo2'))errors.push('getRunningGameInfo2 missing')
if(!bg.includes('FINAL_NOT_SENT_MISSING_PROOF'))errors.push('final proof gate missing')
if(!bg.includes('FINAL_COLLECTION_GRACE_MS = 5000'))errors.push('terminal collection grace missing')
if(bg.includes('details: captureTerminalDetails(observedAt)'))errors.push('terminal details are still frozen at match_end')
if(!bg.includes('async function commitPendingTerminal'))errors.push('durable terminal commit missing')
if(!bg.includes('async function forceCommitPendingTerminal'))errors.push('exit terminal force-commit missing')
if(!bg.includes('function resumePendingTerminal'))errors.push('restart terminal recovery missing')
if(!bg.includes('function resetMatchScopedState'))errors.push('new-session state reset missing')
if(!bg.includes('pendingOutcome'))errors.push('pending outcome binding missing')
if(!bg.includes('seedSequencesFromQueue'))errors.push('queue sequence restore missing')
if(!bg.includes('https://game-events-status.overwolf.com/'))errors.push('GEP status endpoint missing')

const queue=fs.readFileSync(path.join(root,'src/upload-queue.js'),'utf8')
if(!queue.includes('return `session:${sessionId}`'))errors.push('queue causal key is not immutable session_id')
if(!queue.includes('schema_version: 3'))errors.push('queue schema v3 missing')
if(!queue.includes('RECOVERED_UNKNOWN_IN_FLIGHT'))errors.push('persisted IN_FLIGHT recovery missing')
const lifecycle=fs.readFileSync(path.join(root,'src/lifecycle-machine.js'),'utf8')
if(!lifecycle.includes('attachTerminalProof'))errors.push('durable terminal proof lifecycle API missing')
if(!lifecycle.includes('previous_match_id_rediscovered'))errors.push('previous match id tombstone missing')
if(!lifecycle.includes('identity_required_for_recovery'))errors.push('restart identity gate missing')

if(!compat.includes('toHeartbeatV1'))errors.push('production heartbeat compatibility adapter missing')
if(!compat.includes("PRODUCTION_BOOTSTRAP_SCHEMA = 1"))errors.push('production bootstrap schema compatibility missing')

const desktop=fs.readFileSync(path.join(root,'src/desktop.js'),'utf8')
if(!desktop.includes("call('hideDesktop')"))errors.push('desktop close does not hide')
if(desktop.includes('document.execCommand'))errors.push('deprecated execCommand remains')
const overlay=fs.readFileSync(path.join(root,'src/overlay.js'),'utf8')
if(overlay.includes('overlayHoverSensor')||overlay.includes('installDodgeBehavior'))errors.push('overlay dodge remains')
if(!overlay.includes('REFRESH_MS = 1000'))errors.push('overlay polling is not 1s fallback')
if(errors.length){console.error('[release-check] FAIL\n - '+errors.join('\n - '));process.exit(1)}
console.log('[release-check] PASS: Alpha.16 source identity and safety invariants')
