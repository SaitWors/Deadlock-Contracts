import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {fileURLToPath} from 'node:url'

const file=process.argv[2]
if(!file) throw new Error('Usage: node scripts/verify-opk.mjs <file.opk>')
const buf=fs.readFileSync(file)
const entries=[]
for(let i=0;i<=buf.length-46;i++){
  if(buf.readUInt32LE(i)!==0x02014b50) continue
  const method=buf.readUInt16LE(i+10), csize=buf.readUInt32LE(i+20), usize=buf.readUInt32LE(i+24)
  const nlen=buf.readUInt16LE(i+28), xlen=buf.readUInt16LE(i+30), clen=buf.readUInt16LE(i+32), local=buf.readUInt32LE(i+42)
  const name=buf.subarray(i+46,i+46+nlen).toString('utf8').replaceAll('\\','/')
  entries.push({name,method,csize,usize,local})
  i+=45+nlen+xlen+clen
}
if(!entries.length) throw new Error('ZIP central directory not found')
const names=new Set(entries.map(e=>e.name))
const errors=[]
if(!names.has('manifest.json')) errors.push('manifest.json is not at package root')
if(!names.has('fixtures/preview.json')) errors.push('fixtures/preview.json missing')
for(const name of names){
  if(name.startsWith('/')||name.includes('../')) errors.push(`unsafe path: ${name}`)
  if(/(^|\/)(?:\.git|node_modules|tests|scripts|docs|schemas)(?:\/|$)/.test(name)) errors.push(`development-only content in OPK: ${name}`)
  if(/(^|\/)(?:\.env(?:\.|$)|secrets?\/|review-reports?\/)/i.test(name)) errors.push(`forbidden sensitive/review content: ${name}`)
}
function extract(entry){
  const o=entry.local
  if(buf.readUInt32LE(o)!==0x04034b50) throw new Error(`bad local header ${entry.name}`)
  const n=buf.readUInt16LE(o+26),x=buf.readUInt16LE(o+28),start=o+30+n+x
  const data=buf.subarray(start,start+entry.csize)
  if(entry.method===0)return data
  if(entry.method===8)return zlib.inflateRawSync(data)
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`)
}
const manifestEntry=entries.find(e=>e.name==='manifest.json')
if(manifestEntry){
  let manifest
  try{manifest=JSON.parse(extract(manifestEntry).toString('utf8'))}catch(error){errors.push(`manifest invalid: ${error.message}`)}
  if(manifest){
    const release=JSON.parse(
      fs.readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          '..',
          'release.json'
        ),
        'utf8'
      )
    )
    if(manifest.meta?.version!==release.manifest_version) errors.push('manifest version mismatch')
    const paths=[manifest.meta?.icon,manifest.meta?.icon_gray,manifest.meta?.launcher_icon,manifest.meta?.window_icon,...Object.values(manifest.data?.windows||{}).map(w=>w?.file)].filter(Boolean)
    for(const p of paths) if(!names.has(String(p).replaceAll('\\','/'))) errors.push(`manifest path missing: ${p}`)
  }
}
if(errors.length){console.error('[verify-opk] FAIL\n - '+errors.join('\n - '));process.exit(1)}
console.log(`[verify-opk] PASS ${entries.length} entries · ${path.basename(file)}`)
