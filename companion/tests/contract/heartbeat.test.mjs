import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const S=require('../../src/schema.js');const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/evidence-final-valid.json',import.meta.url),'utf8'))
test('final fixture satisfies evidence v9 safety gate',()=>{
  const payload = { ...fixture, client_version: S.CLIENT_VERSION, version: S.CLIENT_VERSION }
  assert.equal(S.validateEvidenceV8(payload, { final: true }), true)
})
