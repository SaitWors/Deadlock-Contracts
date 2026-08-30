import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const Schema=require('../../src/schema.js')
const Product=require('../../src/product.js')
const Compat=require('../../src/server-compat.js')
const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/bootstrap-production-v1.json',import.meta.url),'utf8'))

test('production web 0.10.1-alpha.10 bootstrap schema v1 is accepted',()=>{
  assert.equal(Schema.validateBootstrap(fixture),true)
  const product=Product.normalizeBootstrap(fixture)
  assert.equal(product.schema_version,1)
  assert.equal(product.boards[0].options[0].conditions[0].metric,'player.kills')
  assert.equal(product.boards[0].options[0].game_match_mode,'STANDARD')
  assert.equal(product.boards[0].options[1].status,'SKIPPED')
})

test('Alpha.16 local evidence is projected to exact production heartbeat v1 allow-list',()=>{
  const wire=Compat.toHeartbeatV1({
    schema_version:8,client_version:'0.5.2-alpha.16',version:'0.5.2-alpha.16',device_id:'device-private',
    event_type:'match_ended',session_id:'session-abc',session_started_at:'2026-08-27T08:30:00Z',
    match_id:123456789,match_clock_s:1200,match_clock_observed_at:'2026-08-27T08:50:00Z',
    terminal_proof:{type:'gep_match_end',observed_at:'2026-08-27T08:50:01Z'},observed_at:'2026-08-27T08:50:01Z',
    idempotency_key:'session:session-abc:event:match_ended:schema:8',sequence:3,
    game_running:true,steam_id64:'76561198000000000',phase:'PostGame',game_mode:{match_mode:'Unranked',game_mode:'Normal'},
    gep_version:'311.0.0',live_stats:{kills:8,deaths:2,assists:9,unknown:999},local_team:'AMBER',match_outcome:'AMBER',
  })
  const expected=['client_event_id','game_running','steam_id64','phase','game_mode','match_id','gep_version','version','live_stats','session_id','session_started_at','session_ended_at','session_start_reason','session_end_reason','match_clock_s','match_clock_observed_at','local_team','match_outcome','match_outcome_event_at','match_outcome_event_match_id','event_type']
  assert.deepEqual(Object.keys(wire),expected)
  assert.equal(wire.event_type,'match_ended')
  assert.equal(wire.session_end_reason,'match_end')
  assert.equal(wire.session_ended_at,'2026-08-27T08:50:01Z')
  assert.equal(wire.client_event_id.length<=80,true)
  assert.equal(wire.live_stats.unknown,undefined)
  assert.equal(wire.steam_id64,'76561198000000000')
})

test('interrupted local lifecycle maps to non-terminal production game_stopped event',()=>{
  const wire=Compat.toHeartbeatV1({client_version:'0.5.2-alpha.16',event_type:'interrupted',session_id:'s',observed_at:'2026-08-27T08:00:00Z',idempotency_key:'interrupt-test',sequence:2,match_clock_s:300})
  assert.equal(wire.event_type,'game_stopped')
  assert.equal(wire.session_end_reason,'interrupted')
  assert.equal(wire.session_ended_at,'2026-08-27T08:00:00Z')
})
