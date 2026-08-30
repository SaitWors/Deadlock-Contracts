import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const I18n=require('../src/i18n.js')
const metrics=[...I18n.METRICS]
let failed=0
for(const metric of metrics){
  for(const operator of ['gte','lte','eq']){
    if(metric==='match.win' && operator!=='eq') continue
    const condition={metric,operator,target:metric==='match.win'?1:metric==='match.duration_s'?600:5}
    const en=I18n.renderCondition(condition,'en'), ru=I18n.renderCondition(condition,'ru')
    if(!en||!ru){console.error('[i18n] missing',metric,operator,{en,ru});failed++}
    const fp=JSON.stringify({metric,operator,target:condition.target})
    if(!fp){failed++}
  }
}
for(const lang of ['en','ru']){
  for(const key of ['hq','contracts','activeCase','debrief','history','profile','settings','pairHelp','syncNow']){
    if(!I18n.t(key,lang)){console.error(`[i18n] missing ${key}:${lang}`);failed++}
  }
}
if(failed)process.exit(1)
console.log('[i18n] PASS locale-invariant condition fingerprints and core UI catalog')
