import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'))
const companionVersion = release.product_version
const manifestVersion = release.manifest_version
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(companionVersion || '')) {
  throw new Error('Companion release.json product_version is required and must be a release version')
}
if (!/^\d+\.\d+\.\d+\.\d+$/.test(manifestVersion || '')) {
  throw new Error('Companion release.json manifest_version is required')
}

// The standalone Companion source archive does not need the backend manifest.
const projectReleaseFile = path.join(root, '..', 'release.json')
if (fs.existsSync(projectReleaseFile)) {
  const projectRelease = JSON.parse(fs.readFileSync(projectReleaseFile, 'utf8'))
  if (projectRelease.companion_version !== companionVersion ||
      projectRelease.companion_manifest_version !== manifestVersion ||
      projectRelease.web_version !== release.production_web_version) {
    throw new Error('Project and Companion release.json versions disagree')
  }
}

const releaseName = `Deadlock-Contracts-Companion-${companionVersion}`
const bundleName = `${releaseName}-QA`
const releaseDirectory = path.join(root, 'release')
const qaRoot = path.join(releaseDirectory, bundleName)
const buildRoot = path.join(releaseDirectory, '.qa-bundle-build')
const sourceCompanionRoot = path.join(buildRoot, releaseName, 'companion')
const sourceArchive = path.join(qaRoot, 'SOURCE', `${releaseName}-source.zip`)
const bundleArchive = path.join(releaseDirectory, `${bundleName}-BUNDLE.zip`)
const bundleChecksum = path.join(releaseDirectory, `${bundleName}-BUNDLE.sha256`)
const releaseNotes = `RELEASE_NOTES_${companionVersion}_RU.md`

const copyFile = (source, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const qaDocuments = [
  'docs/OVERWOLF_QA_HANDOFF_RU.md',
  'docs/OVERWOLF_RELEASE_MATRIX_RU.md',
]
const sourceFiles = [
  'release.json', 'package.json', 'manifest.json', 'background.html',
  'index.html', 'overlay.html', 'THIRD_PARTY_NOTICES.txt',
  'README_RU.md', 'QA_BUNDLE_START_HERE_RU.md', 'CHANGELOG.md', releaseNotes,
]
const sourceDirectories = [
  'assets', 'licenses', 'scripts', 'src', 'styles', 'tests', 'schemas', 'fixtures', 'docs',
]

// Validate the inventory before replacing an earlier QA bundle.
for (const relative of [...sourceFiles, ...qaDocuments]) {
  if (!fs.statSync(path.join(root, relative)).isFile()) throw new Error(`missing source file: ${relative}`)
}
for (const relative of sourceDirectories) {
  if (!fs.statSync(path.join(root, relative)).isDirectory()) throw new Error(`missing source directory: ${relative}`)
}

execFileSync(process.execPath, [path.join(root, 'scripts/package-release.mjs')], { stdio: 'inherit' })
const opk = path.join(root, 'dist', `${releaseName}.opk`)
execFileSync(process.execPath, [path.join(root, 'scripts/verify-opk.mjs'), opk], { stdio: 'inherit' })

fs.rmSync(qaRoot, { recursive: true, force: true })
fs.rmSync(buildRoot, { recursive: true, force: true })
fs.rmSync(bundleArchive, { force: true })
fs.rmSync(bundleChecksum, { force: true })
fs.mkdirSync(qaRoot, { recursive: true })
fs.mkdirSync(sourceCompanionRoot, { recursive: true })

try {
  copyFile(path.join(root, 'QA_BUNDLE_START_HERE_RU.md'), path.join(qaRoot, '00_START_HERE_RU.md'))
  copyFile(opk, path.join(qaRoot, 'OPK', `${releaseName}.opk`))
  copyFile(path.join(root, 'dist', `${releaseName}.cdx.json`), path.join(qaRoot, 'OPK', `${releaseName}.cdx.json`))
  copyFile(path.join(root, 'dist', 'SHA256SUMS.txt'), path.join(qaRoot, 'OPK', 'SHA256SUMS.txt'))
  copyFile(path.join(root, releaseNotes), path.join(qaRoot, 'QA_DOCS', releaseNotes))
  for (const relative of qaDocuments) {
    copyFile(path.join(root, relative), path.join(qaRoot, 'QA_DOCS', path.basename(relative)))
  }

  // Current QA_DOCS contain instructions, not old PASS reports or screenshots.
  // Historical documentation stays with the source snapshot for context.
  for (const relative of sourceFiles) {
    copyFile(path.join(root, relative), path.join(sourceCompanionRoot, relative))
  }
  for (const relative of sourceDirectories) {
    fs.cpSync(path.join(root, relative), path.join(sourceCompanionRoot, relative), { recursive: true })
  }
  fs.mkdirSync(path.dirname(sourceArchive), { recursive: true })
  execFileSync('zip', ['-6', '-q', '-r', sourceArchive, releaseName], { cwd: buildRoot, stdio: 'inherit' })

  const describeFile = file => ({
    path: path.relative(qaRoot, file).split(path.sep).join('/'),
    sha256: sha256(file),
    bytes: fs.statSync(file).size,
  })
  const candidate = {
    schema_version: 1,
    companion_version: companionVersion,
    manifest_version: manifestVersion,
    production_web_target: release.production_web_version,
    evidence_schema_version: release.evidence_schema_version,
    bootstrap_compatible_versions: release.bootstrap_compatible_versions,
    opk: describeFile(path.join(qaRoot, 'OPK', `${releaseName}.opk`)),
    sbom: describeFile(path.join(qaRoot, 'OPK', `${releaseName}.cdx.json`)),
    source: describeFile(sourceArchive),
    packaging_checks: { release_identity: 'passed', opk_structure: 'passed' },
    manual_qa: 'not_recorded',
    overwolf_submission: 'not_recorded',
    overwolf_approval: 'not_recorded',
  }
  fs.writeFileSync(path.join(qaRoot, 'CANDIDATE.json'), `${JSON.stringify(candidate, null, 2)}\n`)

  const contentFiles = [
    '00_START_HERE_RU.md', 'CANDIDATE.json', 'OPK/SHA256SUMS.txt',
    candidate.opk.path, candidate.sbom.path, candidate.source.path,
    `QA_DOCS/${releaseNotes}`, ...qaDocuments.map(relative => `QA_DOCS/${path.basename(relative)}`),
  ].sort()
  const contentChecksums = contentFiles
    .map(relative => `${sha256(path.join(qaRoot, relative))}  ${relative}`)
    .join('\n') + '\n'
  fs.writeFileSync(path.join(qaRoot, 'BUNDLE_CONTENT_SHA256SUMS.txt'), contentChecksums)

  execFileSync('zip', ['-6', '-q', '-r', bundleArchive, bundleName], { cwd: releaseDirectory, stdio: 'inherit' })
  const digest = sha256(bundleArchive)
  fs.writeFileSync(bundleChecksum, `${digest}  ${path.basename(bundleArchive)}\n`)
  console.log(`QA_BUNDLE=${bundleArchive}`)
  console.log(`SHA256=${digest}`)
  console.log(`SIZE=${fs.statSync(bundleArchive).size}`)
} finally {
  fs.rmSync(buildRoot, { recursive: true, force: true })
}
