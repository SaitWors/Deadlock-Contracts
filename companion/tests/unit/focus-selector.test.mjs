import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const Focus=require('../../src/focus-selector.js')

function candidate({key,metric,known=true,percent=0,activity=null,complete=false}){
  return {key,condition:{metric},progress:{known,percent,allow_completion_animation:complete},activity}
}

test('live measurable condition beats pending match.win in compound contract',()=>{
  const now=100000
  const result=Focus.choose([
    candidate({key:'win',metric:'match.win',known:false}),
    candidate({key:'damage',metric:'player.hero_damage',known:true,percent:41}),
  ],{now})
  assert.equal(result.candidate.key,'damage')
  assert.equal(result.reason,'live_progress')
})

test('recent kill activity switches focus to kill objective',()=>{
  const now=100000
  const result=Focus.choose([
    candidate({key:'damage',metric:'player.hero_damage',known:true,percent:50,activity:{at:now-500}}),
    candidate({key:'kills',metric:'player.kills',known:true,percent:20,activity:{at:now-100,priority_until:now+3000}}),
  ],{now})
  assert.equal(result.candidate.key,'kills')
  assert.equal(result.reason,'recent_activity')
})

test('sticky focus prevents visual thrash during one activity burst',()=>{
  const now=100000
  const result=Focus.choose([
    candidate({key:'damage',metric:'player.hero_damage',known:true,percent:50}),
    candidate({key:'kills',metric:'player.kills',known:true,percent:20}),
  ],{now,stickyKey:'damage',stickyUntil:now+1000})
  assert.equal(result.candidate.key,'damage')
  assert.equal(result.reason,'sticky')
})
