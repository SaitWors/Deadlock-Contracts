import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';const js=fs.readFileSync(new URL('../../src/overlay.js',import.meta.url),'utf8');const html=fs.readFileSync(new URL('../../overlay.html',import.meta.url),'utf8')
test('overlay consumes DTO v2 at one second fallback',()=>{assert.match(js,/dto_version/);assert.match(js,/REFRESH_MS = 1000/);assert.match(js,/revision/)} )
test('overlay exposes stale/unavailable state',()=>{assert.match(js,/STALE/);assert.match(js,/UNAVAILABLE/);assert.match(js,/LIVE DATA IS STALE/)})
test('hover dodge implementation is removed',()=>{assert.doesNotMatch(js,/installDodgeBehavior|overlayHoverSensor|pointerenter/);assert.doesNotMatch(html,/overlayHoverSensor|overlay-focus\.js/)})


test('overlay completion effects follow progress allow_completion_animation',()=>{assert.match(js,/allow_completion_animation/);assert.match(js,/focus-completion-burst/)})
