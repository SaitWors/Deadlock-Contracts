import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';const js=fs.readFileSync(new URL('../../src/desktop.js',import.meta.url),'utf8');const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8')
test('desktop X hides instead of terminating background',()=>{assert.match(js,/closeBtn[\s\S]{0,180}call\(['\"]hideDesktop/);assert.doesNotMatch(js,/closeBtn[\s\S]{0,180}call\(['\"]exitApp/)})
test('pair code is validated without silent character stripping',()=>{assert.match(js,/normalizePairCode/);assert.doesNotMatch(js,/pairCode[^\n]*replace\(\/\[\^A-Z0-9\]/)})
test('sync success requires structured result ok',()=>{assert.match(js,/result\.ok\) toast\(t\(['\"]syncComplete/)} )
test('clipboard uses background Overwolf Clipboard API and no execCommand',()=>{assert.match(js,/call\(['\"]copyText/);assert.doesNotMatch(js,/execCommand/)})
test('settings expose recovery, auto-hide, privacy and explicit exit controls',()=>{for(const id of ['forceSignOutBtn','exportQueueBtn','clearCacheBtn','privacyBtn','supportBtn','replayIntroBtn','exitBtn','hotkeyWarning'])assert.match(html,new RegExp(`id=["']${id}["']`),id);assert.match(html,/data-auto-hide="0"/);assert.match(html,/data-auto-hide="30000"/)})

test('lock and reroll UI fail closed on stale GEP during a running game',()=>{
  assert.match(js,/gepBlocksAction/)
  assert.match(js,/\['STALE',\s*'UNAVAILABLE'\]/)
  assert.match(js,/lockBlockedGep/)
})


test('desktop follows a newly detected live mode and rerenders product views',()=>{
  assert.match(js,/activeMode = detectedLiveMode/)
  assert.match(js,/activeCaseMode = detectedLiveMode/)
  assert.match(js,/game_running: snapshot\.game_running/)
  assert.match(js,/if \(snapshot\.game_running && detectedMode\) activeCaseMode = detectedMode/)
})


test('active case re-renders on live evidence revision without full product refresh',()=>{
  assert.match(js,/evidence_revision/)
  assert.match(js,/let liveSignature = ''/)
  assert.match(js,/renderActiveCase\(\)/)
})

test('active case explains provider wait and durable next-match queue',()=>{
  assert.match(js,/WAITING FOR PROVIDER/)
  assert.match(js,/ЖДЁМ ПОДТВЕРЖДЕНИЕ/)
  assert.match(js,/NEXT MATCH QUEUED/)
  assert.match(js,/СЛЕДУЮЩИЙ МАТЧ СОХРАНЁН/)
  assert.match(js,/queued_matches/)
})
