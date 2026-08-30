import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const I18n=require('../src/i18n.js')
let failed=0
const required=['privacy.summary','hotkey.unassigned','pair.invalid_format','sync.offline','update.CHECKING','update.UP_TO_DATE','update.UPDATE_AVAILABLE','update.PENDING_RESTART','update.FAILED','ad.unavailable','ad.served','ad.sponsored','ad.requesting','ad.loading_sdk','ad.sdk_init_failed','ad.sdk_unavailable']
for(const lang of ['en','ru'])for(const key of required)if(!I18n.t(key,lang)){console.error(`[ui-string] missing ${key}:${lang}`);failed++}
const runtimeFiles=['src/desktop.js','src/overlay.js','src/background-engine.js']
for(const file of runtimeFiles){const text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');for(const bad of ['document.execCommand','OPEN PAIRING PAGE → https://deadlock-contracts.online'])if(text.includes(bad)){console.error(`[ui-string] forbidden ${bad} in ${file}`);failed++}}
for(const htmlFile of ['index.html']){
  const text=fs.readFileSync(new URL('../'+htmlFile,import.meta.url),'utf8')
  const keys=new Set([...text.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map(match=>match[1]))
  for(const key of keys) for(const lang of ['en','ru']) if(!I18n.t(key,lang)){console.error(`[ui-string] ${htmlFile} missing ${key}:${lang}`);failed++}
}
if(failed)process.exit(1)
console.log('[ui-string] PASS critical RU/EN recovery/status strings, HTML catalog references and deprecated copy path')
