import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const release = '0.5.2-alpha.4'
const dist = path.join(root, 'dist')
const staging = path.join(dist, '.opk-staging')
const opk = path.join(dist, `Deadlock-Contracts-Companion-${release}.opk`)
const checksum = path.join(dist, 'SHA256SUMS.txt')

const runtimeFiles = [
  'manifest.json', 'background.html', 'index.html', 'overlay.html', 'THIRD_PARTY_NOTICES.txt',
  'src/background-engine.js', 'src/session-guard.js', 'src/desktop.js', 'src/overlay.js', 'src/overlay-focus.js', 'src/product.js', 'src/shared.js',
  'styles/tokens.css', 'styles/app.css', 'styles/overlay.css',
  'assets/icon.png', 'assets/icon_gray.png', 'assets/launcher_icon.ico', 'assets/window_icon.png',
  'assets/mark.svg', 'assets/brand-hero.jpg', 'assets/brand-wordmark.jpg', 'assets/curator-contract.jpg',
]
const runtimeDirectories = ['assets/fonts', 'licenses']

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

execFileSync('zip', ['-6', '-q', '-r', opk, '.'], { cwd: staging, stdio: 'inherit' })
const archive = fs.readFileSync(opk)
const digest = crypto.createHash('sha256').update(archive).digest('hex')
fs.writeFileSync(checksum, `${digest}  ${path.basename(opk)}\n`, 'utf8')
fs.rmSync(staging, { recursive: true, force: true })

console.log(`OPK=${opk}`)
console.log(`SHA256=${digest}`)
console.log(`SIZE=${archive.length}`)
