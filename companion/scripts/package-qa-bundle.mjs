import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseFile = [path.join(root, 'release.json'), path.join(root, '..', 'release.json')].find(fs.existsSync)
if (!releaseFile) throw new Error('release.json is required beside the Companion root or its parent')
const releaseMetadata = JSON.parse(fs.readFileSync(releaseFile, 'utf8'))
const companionVersion = String(releaseMetadata.companion_version || '')
if (!companionVersion) throw new Error('release.json companion_version is required')

const releaseName = `Deadlock-Contracts-Companion-${companionVersion}`
const bundleName = `${releaseName}-QA`
const releaseDirectory = path.join(root, 'release')
const qaRoot = path.join(releaseDirectory, bundleName)
const buildRoot = path.join(releaseDirectory, '.qa-bundle-build')
const sourceProjectRoot = path.join(buildRoot, releaseName)
const sourceCompanionRoot = path.join(sourceProjectRoot, 'companion')
const sourceArchive = path.join(qaRoot, 'SOURCE', `${releaseName}-source.zip`)
const bundleArchive = path.join(releaseDirectory, `${bundleName}-BUNDLE.zip`)
const bundleChecksum = path.join(releaseDirectory, `${bundleName}-BUNDLE.sha256`)
const evidenceRoot = path.join(root, 'qa-evidence')
const buildInfo = `BUILD_INFO_${companionVersion}.txt`
const releaseNotes = `RELEASE_NOTES_${companionVersion}_RU.md`
const overlayNotes = `docs/OVERLAY_FOCUS_${companionVersion}_RU.md`
const testReport = `docs/TEST_REPORT_${companionVersion}_RU.md`
const adsPolicy = `docs/ADVERTISING_AND_OVERLAY_POLICY_${companionVersion}_RU.md`

const copyFile = (source, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

const copyDirectory = (source, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true })
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

execFileSync(process.execPath, [path.join(root, 'scripts/package-release.mjs')], { stdio: 'inherit' })

fs.rmSync(qaRoot, { recursive: true, force: true })
fs.rmSync(buildRoot, { recursive: true, force: true })
fs.rmSync(bundleArchive, { force: true })
fs.rmSync(bundleChecksum, { force: true })
fs.mkdirSync(qaRoot, { recursive: true })
fs.mkdirSync(sourceCompanionRoot, { recursive: true })

copyFile(path.join(root, 'QA_BUNDLE_START_HERE_RU.md'), path.join(qaRoot, '00_START_HERE_RU.md'))
copyFile(path.join(root, 'dist', `${releaseName}.opk`), path.join(qaRoot, 'OPK', `${releaseName}.opk`))
copyFile(path.join(root, 'dist', `${releaseName}.cdx.json`), path.join(qaRoot, 'OPK', `${releaseName}.cdx.json`))
copyFile(path.join(root, 'dist', 'SHA256SUMS.txt'), path.join(qaRoot, 'OPK', 'SHA256SUMS.txt'))

const qaDocuments = [
  'README_RU.md', buildInfo, releaseNotes, 'THIRD_PARTY_NOTICES.txt',
  'docs/DESIGN_PARITY_RU.md', 'docs/MANIFEST_SCHEMA_VALIDATION_2026-08-19.txt',
  'docs/OVERWOLF_QA_HANDOFF_RU.md', 'docs/OVERWOLF_RELEASE_MATRIX_RU.md',
  overlayNotes, adsPolicy, 'docs/SECURITY_MODEL_RU.md', testReport,
]
for (const relative of qaDocuments) copyFile(path.join(root, relative), path.join(qaRoot, 'QA_DOCS', path.basename(relative)))

const evidenceFiles = fs.existsSync(evidenceRoot)
  ? fs.readdirSync(evidenceRoot).filter(file => /^\d{2}-.+\.png$/i.test(file)).sort()
  : []
for (const file of evidenceFiles) copyFile(path.join(evidenceRoot, file), path.join(qaRoot, 'QA_EVIDENCE', file))

// Source ZIP is a self-contained project: it has release.json beside the
// companion directory, so its package/release scripts work after extraction.
copyFile(releaseFile, path.join(sourceProjectRoot, 'release.json'))
const sourceFiles = [
  buildInfo, releaseNotes, 'QA_BUNDLE_START_HERE_RU.md', 'README_RU.md',
  'THIRD_PARTY_NOTICES.txt', 'background.html', 'index.html', 'manifest.json',
  'overlay.html', 'package.json',
]
const sourceDirectories = ['assets', 'licenses', 'scripts', 'src', 'styles', 'tests']
const sourceDocuments = [
  'docs/DESIGN_PARITY_RU.md', 'docs/MANIFEST_SCHEMA_VALIDATION_2026-08-19.txt',
  'docs/OVERWOLF_QA_HANDOFF_RU.md', 'docs/OVERWOLF_RELEASE_MATRIX_RU.md',
  overlayNotes, adsPolicy, 'docs/SECURITY_MODEL_RU.md', testReport,
]
for (const relative of sourceFiles) copyFile(path.join(root, relative), path.join(sourceCompanionRoot, relative))
for (const relative of sourceDirectories) copyDirectory(path.join(root, relative), path.join(sourceCompanionRoot, relative))
for (const relative of sourceDocuments) copyFile(path.join(root, relative), path.join(sourceCompanionRoot, relative))

fs.mkdirSync(path.dirname(sourceArchive), { recursive: true })
execFileSync('zip', ['-6', '-q', '-r', sourceArchive, releaseName], { cwd: buildRoot, stdio: 'inherit' })
fs.rmSync(buildRoot, { recursive: true, force: true })

const contentFiles = [
  path.join(qaRoot, 'OPK', `${releaseName}.opk`),
  path.join(qaRoot, 'OPK', `${releaseName}.cdx.json`),
  sourceArchive,
]
const contentChecksums = contentFiles
  .map(file => `${sha256(file)}  ${path.relative(qaRoot, file).split(path.sep).join('/')}`)
  .join('\n') + '\n'
fs.writeFileSync(path.join(qaRoot, 'BUNDLE_CONTENT_SHA256SUMS.txt'), contentChecksums, 'utf8')

execFileSync('zip', ['-6', '-q', '-r', bundleArchive, bundleName], { cwd: releaseDirectory, stdio: 'inherit' })
const digest = sha256(bundleArchive)
fs.writeFileSync(bundleChecksum, `${digest}  ${path.basename(bundleArchive)}\n`, 'utf8')

console.log(`QA_BUNDLE=${bundleArchive}`)
console.log(`SHA256=${digest}`)
console.log(`SIZE=${fs.statSync(bundleArchive).size}`)
