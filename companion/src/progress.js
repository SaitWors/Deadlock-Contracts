(function attachProgress(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCProgress = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const MONOTONIC_METRICS = new Set([
    'player.kills','player.deaths','player.assists','player.hero_damage','player.object_damage',
    'player.healing','player.scoreboard_healing','player.net_worth.final','match.duration_s',
  ])
  const FINAL_STATUSES = new Set(['COMPLETED','FAILED','SETTLED','PARTIAL','PARTIALLY_SETTLED','EXPIRED','VOID'])
  const LIVE_METRICS = new Set([...MONOTONIC_METRICS, 'player.kda'])
  function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
  function serverFinal(context) {
    const status = String(context?.server_status || '').toUpperCase()
    if (!FINAL_STATUSES.has(status)) return null
    const current = finite(context?.server_current)
    const target = finite(context?.server_target)
    return {status, current, target}
  }
  function decorate(result) {
    return { ...result, supported: result.supported === true, value: result.current ?? null, percent: result.visual_percent ?? 0, provisional_pass: ['TARGET_REACHED_PROVISIONAL','ON_TARGET_PROVISIONAL','WITHIN_LIMIT'].includes(result.state) && result.state !== 'WITHIN_LIMIT' }
  }
  function evaluate(condition, value, context = {}) {
    const metric = String(condition?.metric || '')
    const operator = String(condition?.operator || '')
    const current = finite(value)
    const target = finite(condition?.target)
    const final = serverFinal(context)
    const liveSupported = LIVE_METRICS.has(metric)
    if (final) {
      return decorate({
        known: final.current !== null || current !== null,
        supported: liveSupported,
        operator,
        current: final.current ?? current,
        target: final.target ?? target,
        visual_percent: Number.isFinite(Number(context?.server_percent)) ? clamp(Number(context.server_percent),0,100) : 100,
        state: final.status,
        final: true,
        provisional: false,
        current_text_key: 'progress.server_verdict',
        allow_completion_animation: final.status === 'COMPLETED' || final.status === 'SETTLED',
      })
    }
    if (metric === 'match.win') {
      return decorate({known:false, supported:false, operator:'eq', current:null, target:1, visual_percent:0, state:'PENDING_MATCH_RESULT', final:false, provisional:true, current_text_key:'progress.pending_match_result', allow_completion_animation:false})
    }
    if (!['gte','lte','eq'].includes(operator) || target === null || current === null) {
      return decorate({known:false, supported:liveSupported, operator, current, target, visual_percent:0, state:'UNKNOWN', final:false, provisional:true, current_text_key:'progress.unknown', allow_completion_animation:false})
    }
    if (operator === 'gte') {
      const percent = target <= 0 ? 100 : clamp((current / target) * 100, 0, 100)
      const reached = current >= target
      return decorate({known:true,supported:true,operator,current,target,visual_percent:Math.round(percent),state:reached?'TARGET_REACHED_PROVISIONAL':'IN_PROGRESS',final:false,provisional:true,current_text_key:'progress.current',allow_completion_animation:reached && !context?.stale})
    }
    if (operator === 'lte') {
      const percent = target <= 0 ? (current > 0 ? 100 : 0) : clamp((current / target) * 100,0,100)
      const exceeded = current > target
      return decorate({known:true,supported:true,operator,current,target,visual_percent:Math.round(percent),state:exceeded?'OVERSHOT':'WITHIN_LIMIT',final:false,provisional:true,current_text_key:'progress.budget_used',allow_completion_animation:false})
    }
    const percent = target <= 0 ? (current === target ? 100 : 0) : clamp((current / target) * 100,0,100)
    let state = current < target ? 'IN_PROGRESS' : current === target ? 'ON_TARGET_PROVISIONAL' : 'OVERSHOT'
    if (current > target && !MONOTONIC_METRICS.has(metric)) state = 'IN_PROGRESS'
    return decorate({known:true,supported:true,operator,current,target,visual_percent:Math.round(percent),state,final:false,provisional:true,current_text_key:'progress.exact',allow_completion_animation:false})
  }
  return {MONOTONIC_METRICS, LIVE_METRICS, FINAL_STATUSES, evaluate}
})
