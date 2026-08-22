import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const work = path.dirname(root)
const releaseMetadata = JSON.parse(fs.readFileSync(path.join(work, 'release.json'), 'utf8'))
const companionVersion = String(releaseMetadata.companion_version || '')
if (!companionVersion) throw new Error('release.json companion_version is required')
const releaseName = `Deadlock-Contracts-Companion-${companionVersion}`
const bundleName = `${releaseName}-QA`
const releaseDirectory = path.join(work, 'release')
const qaRoot = path.join(releaseDirectory, bundleName)
const buildRoot = path.join(releaseDirectory, '.qa-bundle-build')
const sourceRoot = path.join(buildRoot, releaseName)
const sourceArchive = path.join(qaRoot, 'SOURCE', `${releaseName}-source.zip`)
const bundleArchive = path.join(releaseDirectory, `${bundleName}-BUNDLE.zip`)
const bundleChecksum = path.join(releaseDirectory, `${bundleName}-BUNDLE.sha256`)
const evidenceRoot = path.join(work, 'qa-evidence')

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
fs.mkdirSync(sourceRoot, { recursive: true })

copyFile(path.join(root, 'QA_BUNDLE_START_HERE_RU.md'), path.join(qaRoot, '00_START_HERE_RU.md'))
copyFile(path.join(root, 'dist', `${releaseName}.opk`), path.join(qaRoot, 'OPK', `${releaseName}.opk`))
copyFile(path.join(root, 'dist', 'SHA256SUMS.txt'), path.join(qaRoot, 'OPK', 'SHA256SUMS.txt'))

const qaDocuments = [
  'README_RU.md',
  'BUILD_INFO_0.5.2-alpha.4.txt',
  'THIRD_PARTY_NOTICES.txt',
  'docs/DESIGN_PARITY_RU.md',
  'docs/MANIFEST_SCHEMA_VALIDATION_2026-08-19.txt',
  'docs/OVERWOLF_QA_HANDOFF_RU.md',
  'docs/OVERWOLF_RELEASE_MATRIX_RU.md',
  'docs/OVERLAY_FOCUS_0.5.2-alpha.4_RU.md',
  'docs/SECURITY_MODEL_RU.md',
  'docs/TEST_REPORT_0.5.2-alpha.4_RU.md',
]
for (const relative of qaDocuments) {
  copyFile(path.join(root, relative), path.join(qaRoot, 'QA_DOCS', path.basename(relative)))
}

const evidenceFiles = fs.existsSync(evidenceRoot)
  ? fs.readdirSync(evidenceRoot).filter(file => /^\d{2}-.+\.png$/i.test(file)).sort()
  : []
for (const file of evidenceFiles) copyFile(path.join(evidenceRoot, file), path.join(qaRoot, 'QA_EVIDENCE', file))

const sourceFiles = [
  'BUILD_INFO_0.5.2-alpha.4.txt',
  'QA_BUNDLE_START_HERE_RU.md',
  'README_RU.md',
  'THIRD_PARTY_NOTICES.txt',
  'background.html',
  'index.html',
  'manifest.json',
  'overlay.html',
  'package.json',
]
const sourceDirectories = ['assets', 'docs', 'licenses', 'scripts', 'src', 'styles', 'tests']
for (const relative of sourceFiles) copyFile(path.join(root, relative), path.join(sourceRoot, relative))
for (const relative of sourceDirectories) copyDirectory(path.join(root, relative), path.join(sourceRoot, relative))

fs.mkdirSync(path.dirname(sourceArchive), { recursive: true })
execFileSync('zip', ['-6', '-q', '-r', sourceArchive, releaseName], { cwd: buildRoot, stdio: 'inherit' })
fs.rmSync(buildRoot, { recursive: true, force: true })

const contentFiles = [
  path.join(qaRoot, 'OPK', `${releaseName}.opk`),
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
