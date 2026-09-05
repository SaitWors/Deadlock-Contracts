import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const schema = JSON.parse(
  fs.readFileSync(new URL('../../schemas/bootstrap.v2.schema.json', import.meta.url), 'utf8'),
)

test('announcement bootstrap fields are optional and schema-version compatible', () => {
  assert.equal(schema.properties.schema_version.const, 2)
  assert.equal(schema.required.includes('announcements'), false)
  assert.equal(schema.required.includes('overlay_announcements'), false)
  assert.equal(schema.properties.announcements.items.$ref, '#/$defs/announcement')
  assert.equal(schema.properties.overlay_announcements.items.$ref, '#/$defs/announcement')
})

test('announcement schema has a closed safe content contract', () => {
  const announcement = schema.$defs.announcement
  assert.equal(announcement.additionalProperties, false)
  assert.deepEqual(announcement.properties.presentation.enum, ['BANNER', 'TOAST', 'MODAL'])
  assert.equal(announcement.properties.body.maxLength, 2000)
  assert.equal(announcement.properties.cta.oneOf[1].additionalProperties, false)
})
