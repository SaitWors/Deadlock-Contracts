(function attachStorage(root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCStorage = api
})(typeof window !== 'undefined' ? window : globalThis, root => {
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  function checksum(value) {
    const text=typeof value==='string'?value:stableStringify(value); let hash=2166136261
    for (let i=0;i<text.length;i++) { hash^=text.charCodeAt(i); hash=Math.imul(hash,16777619) }
    return (hash>>>0).toString(16).padStart(8,'0')
  }
  function envelope(value, schemaVersion=1, now=Date.now()) { return {schema_version:schemaVersion,saved_at:new Date(now).toISOString(),checksum:checksum(value),value} }
  function writeJson(key, value, {schemaVersion=1, storage=root?.localStorage}={}) {
    try {
      if (!storage?.setItem || !storage?.getItem) return {ok:false,code:'STORAGE_UNAVAILABLE',error:'localStorage unavailable'}
      const body=envelope(value,schemaVersion); const raw=JSON.stringify(body); storage.setItem(key,raw)
      const back=storage.getItem(key); if (back !== raw) return {ok:false,code:'READBACK_MISMATCH',error:'storage read-back mismatch'}
      return {ok:true,bytes:new TextEncoder().encode(raw).length,checksum:body.checksum}
    } catch (error) {
      const code = /quota/i.test(String(error?.name || error?.message)) ? 'QUOTA_EXCEEDED' : /stringify|circular|serialize/i.test(String(error?.message)) ? 'SERIALIZE_FAILED' : 'WRITE_FAILED'
      return {ok:false,code,error:String(error?.message || error)}
    }
  }
  function readJson(key, {schemaVersion=null, ttlMs=null, storage=root?.localStorage}={}) {
    try {
      const raw=storage?.getItem?.(key); if (!raw) return {ok:true,value:null,missing:true}
      const parsed=JSON.parse(raw)
      if (!parsed || typeof parsed!=='object' || !('value' in parsed)) return {ok:false,code:'CORRUPT',error:'invalid envelope'}
      if (schemaVersion !== null && Number(parsed.schema_version)!==Number(schemaVersion)) return {ok:false,code:'SCHEMA_MISMATCH',error:'storage schema mismatch'}
      if (checksum(parsed.value)!==parsed.checksum) return {ok:false,code:'CHECKSUM_MISMATCH',error:'storage checksum mismatch'}
      if (ttlMs && parsed.saved_at && Date.now()-Date.parse(parsed.saved_at)>ttlMs) return {ok:true,value:null,expired:true}
      return {ok:true,value:parsed.value,savedAt:parsed.saved_at}
    } catch (error) { return {ok:false,code:'CORRUPT',error:String(error?.message || error)} }
  }
  function remove(key, storage=root?.localStorage) { try { storage?.removeItem?.(key); return {ok:true} } catch(error){return {ok:false,code:'REMOVE_FAILED',error:String(error?.message||error)}} }
  function cryptoCall(method, value) { return new Promise((resolve,reject)=>{
    const fn=root?.overwolf?.cryptography?.[method]; if (!fn) return reject(Object.assign(new Error('Secure storage unavailable'),{code:'SECURE_STORAGE_UNAVAILABLE'}))
    try { fn(value, result=>{ if(result?.success) resolve(result.ciphertext ?? result.plaintext); else reject(Object.assign(new Error(result?.error || 'Secure storage failed'),{code:'SECURE_STORAGE_FAILED'})) }) } catch(error){reject(error)}
  }) }
  async function writeSecureJson(key, value, {schemaVersion=1, storage=root?.localStorage}={}) {
    try { const raw=JSON.stringify(envelope(value,schemaVersion)); const encrypted=await cryptoCall('encryptForCurrentUser',raw); storage.setItem(key,encrypted); const back=storage.getItem(key); if(back!==encrypted)return{ok:false,code:'READBACK_MISMATCH'}; return {ok:true,bytes:new TextEncoder().encode(encrypted).length} }
    catch(error){ return {ok:false,code:error?.code || (/quota/i.test(String(error?.message))?'QUOTA_EXCEEDED':'SECURE_WRITE_FAILED'),error:String(error?.message||error)} }
  }
  async function readSecureJson(key, {schemaVersion=null, ttlMs=null, storage=root?.localStorage}={}) {
    try { const encrypted=storage?.getItem?.(key); if(!encrypted)return{ok:true,value:null,missing:true}; const raw=await cryptoCall('decryptForCurrentUser',encrypted); const parsed=JSON.parse(raw); if(schemaVersion!==null&&Number(parsed.schema_version)!==Number(schemaVersion))return{ok:false,code:'SCHEMA_MISMATCH'}; if(checksum(parsed.value)!==parsed.checksum)return{ok:false,code:'CHECKSUM_MISMATCH'}; if(ttlMs&&parsed.saved_at&&Date.now()-Date.parse(parsed.saved_at)>ttlMs)return{ok:true,value:null,expired:true}; return{ok:true,value:parsed.value,savedAt:parsed.saved_at} }
    catch(error){return{ok:false,code:error?.code||'SECURE_READ_FAILED',error:String(error?.message||error)}}
  }
  function sanitizeAnnouncementList(value) { return (Array.isArray(value)?value:[]).slice(0,5).map(item=>item&&typeof item==='object'?{id:String(item.id||'').slice(0,64),revision:Math.max(1,Math.trunc(Number(item.revision)||1)),phase:'ACTIVE',severity:String(item.severity||'INFO'),presentation:String(item.presentation||'BANNER'),effect:String(item.effect||'NONE'),dismiss_policy:String(item.dismiss_policy||'DISMISSIBLE'),priority:Math.max(0,Math.min(100,Math.trunc(Number(item.priority)||0))),title:String(item.title||'').slice(0,160),body:String(item.body||'').slice(0,2000),cta:item.cta&&typeof item.cta==='object'?{label:String(item.cta.label||'').slice(0,64),url:String(item.cta.url||'').slice(0,500)}:null,starts_at:String(item.starts_at||''),ends_at:String(item.ends_at||''),show_countdown:item.show_countdown===true}:null).filter(item=>item&&item.id&&item.title&&item.body) }
  function sanitizeProductCache(product) { if(!product||typeof product!=='object')return product; const clone=JSON.parse(JSON.stringify(product)); delete clone.account; if(clone.device && typeof clone.device==='object'){ delete clone.device.token; delete clone.device.access_token; delete clone.device.steam_id64 } clone.announcements=sanitizeAnnouncementList(clone.announcements);clone.overlay_announcements=sanitizeAnnouncementList(clone.overlay_announcements);return clone }
  return {CACHE_TTL_MS, stableStringify, checksum, envelope, writeJson, readJson, writeSecureJson, readSecureJson, remove, sanitizeProductCache}
})
