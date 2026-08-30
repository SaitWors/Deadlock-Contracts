import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const P=require('../../src/progress.js')
test('lte 0/5 is within limit but never completed',()=>{const r=P.evaluate({metric:'player.deaths',operator:'lte',target:5},0);assert.equal(r.state,'WITHIN_LIMIT');assert.equal(r.allow_completion_animation,false);assert.equal(r.visual_percent,0)})
test('eq overshoot is explicit',()=>{const r=P.evaluate({metric:'player.kills',operator:'eq',target:5},6);assert.equal(r.state,'OVERSHOT');assert.equal(r.allow_completion_animation,false)})
test('match win remains unknown until final server verdict',()=>{const r=P.evaluate({metric:'match.win',operator:'eq',target:1},1);assert.equal(r.known,false);assert.equal(r.state,'PENDING_MATCH_RESULT')})
test('final server status overrides provisional math',()=>{const r=P.evaluate({metric:'player.kills',operator:'gte',target:5},2,{server_status:'COMPLETED',server_current:5,server_target:5});assert.equal(r.final,true);assert.equal(r.state,'COMPLETED')})

test('null live value remains pending for match.win',()=>{const r=P.evaluate({metric:'match.win',operator:'eq',target:1},null);assert.equal(r.supported,false);assert.equal(r.state,'PENDING_MATCH_RESULT')})
