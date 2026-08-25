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
const release = String(releaseMetadata.companion_version || '')
if (!release) throw new Error('release.json companion_version is required')
const dist = path.join(root, 'dist')
const staging = path.join(dist, '.opk-staging')
const opk = path.join(dist, `Deadlock-Contracts-Companion-${release}.opk`)
const sbom = path.join(dist, `Deadlock-Contracts-Companion-${release}.cdx.json`)
const checksum = path.join(dist, 'SHA256SUMS.txt')

const runtimeFiles = [
  'manifest.json', 'background.html', 'index.html', 'overlay.html', 'THIRD_PARTY_NOTICES.txt',
  'src/background-engine.js', 'src/session-guard.js', 'src/queue-policy.js', 'src/desktop.js', 'src/desktop-ads.js', 'src/overlay.js', 'src/overlay-focus.js', 'src/product.js', 'src/shared.js',
  'styles/tokens.css', 'styles/app.css', 'styles/overlay.css',
  'assets/icon.png', 'assets/icon_gray.png', 'assets/launcher_icon.ico', 'assets/window_icon.png',
  'assets/mark.svg', 'assets/brand-hero.jpg', 'assets/brand-wordmark.jpg', 'assets/curator-contract.jpg',
]
const runtimeDirectories = ['assets/fonts', 'licenses']
const archiveEpoch = new Date('2000-01-01T00:00:00.000Z')

function sortedEntries(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => {
    if (left.name === right.name) return 0
    return left.name < right.name ? -1 : 1
  })
}

function normalizeArchiveTree(directory) {
  for (const entry of sortedEntries(directory)) {
    const target = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`symlinks are not allowed in the OPK: ${target}`)
    if (entry.isDirectory()) {
      normalizeArchiveTree(target)
      fs.chmodSync(target, 0o755)
    } else if (entry.isFile()) {
      fs.chmodSync(target, 0o644)
    } else {
      throw new Error(`unsupported OPK entry: ${target}`)
    }
    fs.utimesSync(target, archiveEpoch, archiveEpoch)
  }
}

function archiveFileList(directory, prefix = '') {
  const files = []
  for (const entry of sortedEntries(directory)) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...archiveFileList(path.join(directory, entry.name), relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

execFileSync(process.execPath, [path.join(root, 'scripts/check-release.mjs')], { stdio: 'inherit' })
fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(staging, { recursive: true })

for (const relative of runtimeFiles) {
  const source = path.join(root, relative)
  const destination = path.join(staging, relative)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}
for (const relative of runtimeDirectories) {
  fs.cpSync(path.join(root, relative), path.join(staging, relative), { recursive: true })
}

normalizeArchiveTree(staging)
const archiveFiles = archiveFileList(staging)
if (!archiveFiles.length) throw new Error('refusing to build an empty OPK')

const rootBomRef = `pkg:generic/deadlock-contracts-companion@${release}`
const fileComponents = archiveFiles.map(relative => ({
  type: 'file',
  'bom-ref': `file:${relative}`,
  name: relative,
  hashes: [{
    alg: 'SHA-256',
    content: crypto.createHash('sha256').update(fs.readFileSync(path.join(staging, relative))).digest('hex'),
  }],
}))
const cyclonedx = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      'bom-ref': rootBomRef,
      group: 'Mandarin Creator Group',
      name: 'Deadlock Contracts Companion',
      version: release,
      properties: [
        { name: 'deadlock-contracts:manifest-version', value: String(releaseMetadata.companion_manifest_version || '') },
        { name: 'deadlock-contracts:runtime-dependencies', value: 'none; bundled runtime files are enumerated below' },
      ],
    },
  },
  components: fileComponents,
  dependencies: [{ ref: rootBomRef, dependsOn: fileComponents.map(component => component['bom-ref']) }],
}
fs.writeFileSync(sbom, `${JSON.stringify(cyclonedx, null, 2)}\n`, 'utf8')

execFileSync('zip', ['-X', '-6', '-q', opk, ...archiveFiles], {
  cwd: staging,
  env: { ...process.env, TZ: 'UTC' },
  stdio: 'inherit',
})
const archive = fs.readFileSync(opk)
const digest = crypto.createHash('sha256').update(archive).digest('hex')
const sbomDigest = crypto.createHash('sha256').update(fs.readFileSync(sbom)).digest('hex')
fs.writeFileSync(
  checksum,
  `${digest}  ${path.basename(opk)}\n${sbomDigest}  ${path.basename(sbom)}\n`,
  'utf8',
)
fs.rmSync(staging, { recursive: true, force: true })

console.log(`OPK=${opk}`)
console.log(`SHA256=${digest}`)
console.log(`SBOM=${sbom}`)
console.log(`SIZE=${archive.length}`)
