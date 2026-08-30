import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);global.DCSchema=require('../../src/schema.js');global.DCI18n=require('../../src/i18n.js');global.DCProgress=require('../../src/progress.js');global.DCStorage=require('../../src/storage.js');const P=require('../../src/product.js')
test('status map is exhaustive for known contract states',()=>{for(const s of ['OFFERED','LOCKED','VERIFYING','REVIEW_REQUIRED','COMPLETED','FAILED','SETTLED','PARTIAL','PARTIALLY_SETTLED','EXPIRED','VOID','SKIPPED'])assert.ok(P.STATUS_META[s],s)})
test('activeCaseFor never falls back across modes',()=>{const product={active_cases:[{game_match_mode:'RANKED',board_id:'r'}]};assert.equal(P.activeCaseFor(product,'STANDARD'),null);assert.equal(P.activeCaseFor(product,'RANKED').board_id,'r')})


test('Deadlock GEP Street Brawl wins over generic Unranked match_mode',()=>{
  assert.equal(P.normalizeGameModePayload({match_mode:'Unranked',game_mode:'Street Brawl'}),'STREET_BRAWL')
  assert.equal(P.normalizeGameModePayload({match_mode:'Unranked',game_mode:'StreetBrawl'}),'STREET_BRAWL')
  assert.equal(P.normalizeGameModePayload({match_mode:'Unranked',game_mode:'Brawl'}),'STREET_BRAWL')
  assert.equal(P.normalizeGameModePayload({match_mode:1,game_mode:4}),'STREET_BRAWL')
})

test('Deadlock GEP standard and ranked mode pairs remain distinct',()=>{
  assert.equal(P.normalizeGameModePayload({match_mode:'Unranked',game_mode:'Normal'}),'STANDARD')
  assert.equal(P.normalizeGameModePayload({match_mode:'Ranked',game_mode:'Normal'}),'RANKED')
  assert.equal(P.normalizeGameModePayload({match_mode:1,game_mode:1}),'STANDARD')
  assert.equal(P.normalizeGameModePayload({match_mode:4,game_mode:1}),'RANKED')
})

test('queued provider matches survive bootstrap normalization',()=>{
  const option={id:'o1',title_i18n:{ru:'Тест',en:'Test'},game_match_mode:'STANDARD',conditions:[{metric:'player.kills',operator:'gte',target:1,capabilities:[]}],reward_xp:10,selected:true,status:'VERIFYING'}
  const board=P.normalizeBoard({id:'b1',status:'VERIFYING',game_match_mode:'STANDARD',attempts_used:1,max_attempts:3,provider_status:{phase:'VERIFYING',match_id:'102510635',queued_count:1,queued_matches:[{position:1,match_id:'102528343',captured_at:'2026-08-30T02:15:00Z',state:'WAITING_PREVIOUS_VERDICT'}]},options:[option]})
  assert.equal(board.provider_status.queued_count,1)
  assert.equal(board.provider_status.queued_matches[0].match_id,'102528343')
  assert.equal(P.deriveActiveCases([board])[0].provider_status.queued_matches[0].state,'WAITING_PREVIOUS_VERDICT')
})
