import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const Lifecycle=require('../../src/lifecycle-machine.js')

function load(name){return JSON.parse(fs.readFileSync(new URL(`../fixtures/gep/${name}.json`,import.meta.url),'utf8'))}
function run(trace){
  let serial=0
  const lifecycle=Lifecycle.createLifecycleMachine({now:()=> '2026-08-27T00:00:00Z',createId:p=>`${p}-${++serial}`})
  let finals=0
  for(const step of trace.steps){
    if(step.type==='process') lifecycle.observeProcess({running:step.running,processId:step.processId,gameSessionId:step.gameSessionId,observedAt:step.at})
    else if(step.type==='phase') lifecycle.observePhase({phase:step.phase,source:step.source,observedAt:step.at})
    else if(step.type==='match_start') lifecycle.observeMatchStart({observedAt:step.at})
    else if(step.type==='match_id') lifecycle.observeMatchId({matchId:step.matchId,source:step.source,observedAt:step.at})
    else if(step.type==='clock') lifecycle.observeMatchClock({seconds:step.seconds,observedAt:step.at})
    else if(step.type==='history') lifecycle.observeHistory({matches:step.matches,observedAt:step.at})
    else if(step.type==='terminal') {
      const candidate=lifecycle.observeTerminalSignal({type:step.signal,observedAt:step.at})
      if(candidate){
        const proof=lifecycle.correlateTerminal(candidate.id)
        if(proof.ok){const result=lifecycle.finalize(candidate.id,proof);if(result.ok)finals++}
      }
    }
    // A PostGame candidate can become correlatable only after later history.
    const candidate=lifecycle.terminalCandidate()
    if(candidate){const proof=lifecycle.correlateTerminal(candidate.id);if(proof.ok){const result=lifecycle.finalize(candidate.id,proof);if(result.ok)finals++}}
  }
  return {snapshot:lifecycle.snapshot(),finals}
}
for(const name of ['menu-close','normal-match','mid-match-stop']){
  test(`GEP documented simulator trace: ${name}`,()=>{
    const trace=load(name);const result=run(trace)
    assert.equal(result.snapshot.state,trace.expect.state)
    assert.equal(result.finals,trace.expect.finals)
    if(trace.expect.match_id) assert.equal(result.snapshot.finalized?.match_id,trace.expect.match_id)
  })
}
