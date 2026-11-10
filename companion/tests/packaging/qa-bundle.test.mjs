import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const release = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'))
const releaseName = `Deadlock-Contracts-Companion-${release.product_version}`
const repositoryDocumentation = path.join(root, '..', 'PROJECT.md')
const projectDocumentation = fs.existsSync(repositoryDocumentation)
  ? repositoryDocumentation
  : path.join(root, 'PROJECT.md')
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const run = (cwd, command, args) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 8 * 1024 * 1024,
})

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-qa-bundle-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const companion = path.join(directory, 'project', 'companion')
  fs.cpSync(root, companion, {
    recursive: true,
    filter: source => !['dist', 'release', 'node_modules', 'qa-evidence'].includes(
      path.relative(root, source).split(path.sep)[0],
    ),
  })
  fs.copyFileSync(projectDocumentation, path.join(directory, 'project', 'PROJECT.md'))
  const parentRelease = {
    companion_version: release.product_version,
    companion_manifest_version: release.manifest_version,
    web_version: release.production_web_version,
  }
  fs.writeFileSync(path.join(directory, 'project', 'release.json'), JSON.stringify(parentRelease))
  return { directory, companion, parentRelease }
}

test('QA bundle contains verifiable current artifacts and a reproducible standalone source project', { timeout: 120000 }, t => {
  const { directory, companion } = fixture(t)
  fs.writeFileSync(path.join(companion, '.env'), 'QA_TEST_FILE=must-not-be-packaged\n')
  fs.mkdirSync(path.join(companion, 'qa-evidence'))
  fs.writeFileSync(path.join(companion, 'qa-evidence', '01-old-screenshot.png'), 'unverified earlier candidate')
  run(companion, process.execPath, ['scripts/package-qa-bundle.mjs'])

  const output = path.join(companion, 'release')
  run(output, 'sha256sum', ['-c', `${releaseName}-QA-BUNDLE.sha256`])
  const unpacked = path.join(directory, 'unpacked')
  run(output, 'unzip', ['-q', `${releaseName}-QA-BUNDLE.zip`, '-d', unpacked])
  const bundle = path.join(unpacked, `${releaseName}-QA`)
  run(bundle, 'sha256sum', ['-c', 'BUNDLE_CONTENT_SHA256SUMS.txt'])
  run(path.join(bundle, 'OPK'), 'sha256sum', ['-c', 'SHA256SUMS.txt'])

  const candidate = JSON.parse(fs.readFileSync(path.join(bundle, 'CANDIDATE.json'), 'utf8'))
  assert.equal(candidate.companion_version, release.product_version)
  assert.equal(candidate.manifest_version, release.manifest_version)
  assert.equal(candidate.production_web_target, release.production_web_version)
  assert.equal(candidate.manual_qa, 'not_recorded')
  assert.equal(candidate.overwolf_submission, 'not_recorded')
  assert.equal(candidate.overwolf_approval, 'not_recorded')
  for (const artifact of [candidate.opk, candidate.sbom, candidate.source]) {
    const file = path.join(bundle, artifact.path)
    assert.equal(digest(file), artifact.sha256)
    assert.equal(fs.statSync(file).size, artifact.bytes)
  }
  assert.equal(fs.existsSync(path.join(bundle, 'QA_EVIDENCE')), false)
  assert.equal(fs.existsSync(path.join(bundle, 'QA_DOCS')), false)
  assert.equal(digest(path.join(bundle, 'PROJECT.md')), digest(projectDocumentation))
  const packedManifest = JSON.parse(run(bundle, 'unzip', ['-p', candidate.opk.path, 'manifest.json']))
  assert.equal(packedManifest.meta.version, candidate.manifest_version)

  const sourceDirectory = path.join(directory, 'source')
  run(bundle, 'unzip', ['-q', candidate.source.path, '-d', sourceDirectory])
  const extracted = path.join(sourceDirectory, releaseName, 'companion')
  assert.equal(fs.existsSync(path.join(extracted, '..', 'release.json')), false)
  assert.equal(fs.existsSync(path.join(extracted, '..', 'PROJECT.md')), false)
  assert.equal(digest(path.join(extracted, 'PROJECT.md')), digest(projectDocumentation))
  assert.equal(fs.existsSync(path.join(extracted, '.env')), false)
  assert.equal(fs.existsSync(path.join(extracted, 'qa-evidence')), false)
  const checked = run(extracted, 'npm', ['run', 'release:check'])
  t.diagnostic(checked.split('\n').filter(line => /^# (tests|pass|fail) |^\[.+\] PASS/.test(line)).join('\n'))
  run(extracted, process.execPath, ['scripts/package-release.mjs'])
  assert.equal(digest(path.join(extracted, 'dist', `${releaseName}.opk`)), candidate.opk.sha256)
  assert.equal(digest(path.join(extracted, 'dist', `${releaseName}.cdx.json`)), candidate.sbom.sha256)
  run(extracted, process.execPath, ['scripts/verify-opk.mjs', `dist/${releaseName}.opk`])

  // The included source must also be able to create another QA handoff.
  run(extracted, process.execPath, ['scripts/package-qa-bundle.mjs'])
  const rebuilt = JSON.parse(fs.readFileSync(path.join(extracted, 'release', `${releaseName}-QA`, 'CANDIDATE.json'), 'utf8'))
  assert.equal(rebuilt.opk.sha256, candidate.opk.sha256)
  assert.equal(rebuilt.sbom.sha256, candidate.sbom.sha256)
})

test('QA packaging stops on conflicting repository metadata before replacing an earlier bundle', t => {
  const { directory, companion, parentRelease } = fixture(t)
  parentRelease.companion_manifest_version = '0.0.0.0'
  fs.writeFileSync(path.join(directory, 'project', 'release.json'), JSON.stringify(parentRelease))
  const previousBundle = path.join(companion, 'release', `${releaseName}-QA-BUNDLE.zip`)
  fs.mkdirSync(path.dirname(previousBundle), { recursive: true })
  fs.writeFileSync(previousBundle, 'previous-bundle-preserved')
  const result = spawnSync(process.execPath, ['scripts/package-qa-bundle.mjs'], { cwd: companion, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Project and Companion release.json versions disagree/)
  assert.equal(fs.readFileSync(previousBundle, 'utf8'), 'previous-bundle-preserved')
})

test('QA packaging requires the unified document before replacing an earlier bundle', t => {
  const { companion } = fixture(t)
  fs.rmSync(path.join(companion, '..', 'PROJECT.md'))
  fs.rmSync(path.join(companion, 'PROJECT.md'), { force: true })
  const previousBundle = path.join(companion, 'release', `${releaseName}-QA-BUNDLE.zip`)
  fs.mkdirSync(path.dirname(previousBundle), { recursive: true })
  fs.writeFileSync(previousBundle, 'previous-bundle-preserved')
  const result = spawnSync(process.execPath, ['scripts/package-qa-bundle.mjs'], { cwd: companion, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /PROJECT\.md is required/)
  assert.equal(fs.readFileSync(previousBundle, 'utf8'), 'previous-bundle-preserved')
})
