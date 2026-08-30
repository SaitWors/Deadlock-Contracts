(function attachHealth(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCHealth = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function initial() { return {
    auth:{status:'UNPAIRED',code:null,message:null,updated_at:null},
    secureStorage:{status:'OK',code:null,message:null,updated_at:null},
    backend:{status:'OFFLINE',code:null,message:null,requestId:null,updated_at:null,last_success_at:null},
    gep:{status:'STARTING',feature:null,code:null,message:null,updated_at:null,last_clock_at:null,age_ms:null},
    storage:{status:'OK',code:null,key:null,message:null,updated_at:null},
    queue:{status:'OK',count:0,rejected:0,code:null,message:null,updated_at:null},
  } }
  function createHealth() {
    const state=initial()
    function patch(channel, value={}) { state[channel]={...state[channel],...value,updated_at:new Date().toISOString()}; return state[channel] }
    function success(channel, extra={}) { return patch(channel,{status:'OK',code:null,message:null,last_success_at:new Date().toISOString(),...extra}) }
    function report(channel, code, message, extra={}) { return patch(channel,{code:code||null,message:message?String(message):null,...extra}) }
    function gepFreshness({gameRunning,matchConfirmed,lastClockAt,featuresReady,paused=false,now=Date.now()}) {
      if(!featuresReady){ patch('gep',{status:'UNAVAILABLE',age_ms:null}); return state.gep }
      if(!gameRunning || !matchConfirmed){ patch('gep',{status:gameRunning?'NO_MATCH':'STARTING',age_ms:null}); return state.gep }
      if(paused){ patch('gep',{status:'PAUSED',age_ms:lastClockAt?Math.max(0,now-Date.parse(lastClockAt)):null}); return state.gep }
      const age=lastClockAt?Math.max(0,now-Date.parse(lastClockAt)):Infinity
      patch('gep',{status:age<=5000?'LIVE':age<=15000?'LAGGING':'STALE',age_ms:Number.isFinite(age)?age:null,last_clock_at:lastClockAt||null})
      return state.gep
    }
    function snapshot(){return JSON.parse(JSON.stringify(state))}
    return {state,patch,success,report,gepFreshness,snapshot}
  }
  return {initial,createHealth}
})
