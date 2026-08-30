import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
const release=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'))
const manifestPath=path.join(root,'manifest.json')
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
const write=process.argv.includes('--write')
const buildOpk=process.argv.includes('--opk')
const expectedMeta=`(function attachReleaseMeta(root, factory) {\n  const api = factory()\n  if (typeof module === 'object' && module.exports) module.exports = api\n  if (root) root.DCRelease = api\n})(typeof window !== 'undefined' ? window : globalThis, () => Object.freeze({\n  productVersion: '${release.product_version}',\n  manifestVersion: '${release.manifest_version}',\n  evidenceSchemaVersion: ${release.evidence_schema_version},\n  bootstrapSchemaVersion: ${release.bootstrap_schema_version},\n  bootstrapCompatVersions: Object.freeze(${JSON.stringify(release.bootstrap_compatible_versions || [release.bootstrap_schema_version])}),\n  productionWebVersion: '${release.production_web_version || ''}',\n  productionBootstrapSchemaVersion: ${Number(release.production_bootstrap_schema_version || release.bootstrap_schema_version)},\n}))\n`
const metaPath=path.join(root,'src','release-meta.js')
if(write){
  manifest.meta.version=release.manifest_version
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n')
  fs.writeFileSync(metaPath,expectedMeta)
}else{
  const current=fs.readFileSync(metaPath,'utf8')
  if(current!==expectedMeta) throw new Error('src/release-meta.js is not generated from release.json; run node scripts/build-release.mjs --write')
  if(manifest.meta?.version!==release.manifest_version) throw new Error('manifest version does not match release.json')
}
if(!buildOpk){
  console.log(`[release-meta] PASS ${release.product_version} / ${release.manifest_version}`)
  process.exit(0)
}
const stage=path.join(root,'dist','opk-stage')
fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true})
const roots=['manifest.json','background.html','index.html','overlay.html','THIRD_PARTY_NOTICES.txt']
const dirs=['src','styles','assets','licenses','fixtures']
for(const file of roots) fs.copyFileSync(path.join(root,file),path.join(stage,file))
for(const dir of dirs) fs.cpSync(path.join(root,dir),path.join(stage,dir),{recursive:true})
const out=path.join(root,'dist',`Deadlock-Contracts-Companion-${release.product_version}.opk`)
fs.rmSync(out,{force:true})
const seven=spawnSync('7z',['a','-tzip','-mx=5',out,'.'],{cwd:stage,stdio:'inherit',shell:process.platform==='win32'})
if(seven.status!==0) throw new Error('7-Zip failed or is not installed')
console.log(`[opk] ${out}`)
