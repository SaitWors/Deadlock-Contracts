import {readdirSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const files=[]
function walk(dir){for(const name of readdirSync(dir)){const p=join(dir,name);const st=statSync(p);if(st.isDirectory())walk(p);else if(/\.(?:js|mjs)$/.test(name))files.push(p)}}
for(const dir of ['src','scripts','tests'].map(x=>join(root,x))) walk(dir)
let failed=0
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){failed++;console.error(`[syntax] FAIL ${relative(root,file)}\n${r.stderr}`)}}
if(failed)process.exit(1)
console.log(`[syntax] PASS ${files.length} JavaScript files`)
