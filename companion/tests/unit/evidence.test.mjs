import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const Evidence=require('../../src/evidence.js')

test('partial missing roster fields preserve previous evidence',()=>{
  const merged=Evidence.mergeMetric(5817,null,{monotonic:true})
  assert.equal(merged.accepted,false)
  assert.equal(merged.changed,false)
  assert.equal(merged.value,5817)
  assert.equal(merged.reason,'MISSING_PARTIAL_UPDATE')
})

test('lower Street Brawl round sample cannot decrease monotonic match evidence',()=>{
  const merged=Evidence.mergeMetric(5817,0,{monotonic:true})
  assert.equal(merged.accepted,true)
  assert.equal(merged.changed,false)
  assert.equal(merged.value,5817)
  assert.equal(merged.reason,'LOWER_SAMPLE_IGNORED')
})

test('session correlation does not change when match id becomes known',()=>{
  const before={session_id:'session-1',match_id:null}
  const after={session_id:'session-1',match_id:101991017}
  assert.equal(Evidence.correlationKey(before),'session-1')
  assert.equal(Evidence.correlationKey(after),'session-1')
})
