(function attachLifecycle(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCLifecycle = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const MATCH_STATE = Object.freeze({
    NO_GAME: 'NO_GAME',
    PROCESS_ONLY: 'PROCESS_ONLY',
    MATCH_CONFIRMED: 'MATCH_CONFIRMED',
    TERMINAL_PENDING: 'TERMINAL_PENDING',
    FINALIZED: 'FINALIZED',
    INTERRUPTED: 'INTERRUPTED',
  })

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)) }
  function int(value) {
    const n = Number(value)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }
  function seconds(value) {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
  }

  function createLifecycleMachine({
    now = () => new Date().toISOString(),
    createId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  } = {}) {
    let state = MATCH_STATE.NO_GAME
    let process = null
    let session = null
    let terminalCandidate = null
    let finalized = null
    let historyIds = new Set()
    let baselineHistory = new Set()
    let sequence = 0
    let revision = 0
    const terminalResults = new Map()

    function touch() { revision += 1 }
    function snapshot() {
      return clone({
        state,
        revision,
        sequence,
        process,
        session,
        terminal_candidate: terminalCandidate,
        finalized,
        history_ids: [...historyIds],
      })
    }
    function currentSession() { return clone(session) }
    function nextSequence() { sequence += 1; return sequence }

    function startSession(reason, observedAt = now()) {
      if (session && [MATCH_STATE.MATCH_CONFIRMED, MATCH_STATE.TERMINAL_PENDING].includes(state)) {
        return { created: false, session: currentSession() }
      }
      session = {
        session_id: createId('session'),
        started_at: observedAt,
        confirmed_by: reason,
        match_id: null,
        match_clock_s: null,
        mode: null,
        process_id: process?.processId || null,
        game_session_id: process?.gameSessionId || null,
        baseline_history: [...baselineHistory],
        evidence_revision: 0,
      }
      state = MATCH_STATE.MATCH_CONFIRMED
      terminalCandidate = null
      touch()
      return { created: true, session: currentSession() }
    }

    function ensureConfirmed(reason, observedAt = now()) {
      return startSession(reason, observedAt)
    }

    function observeMatchStart({ observedAt = now() } = {}) {
      const before = state
      const result = ensureConfirmed('match_start', observedAt)
      return {
        confirmed: state === MATCH_STATE.MATCH_CONFIRMED,
        created: result.created,
        before,
        state,
        session: currentSession(),
      }
    }

    function observeProcess({ running, processId = null, gameSessionId = null, observedAt = now() } = {}) {
      if (running) {
        process = {
          running: true,
          processId: processId ?? null,
          gameSessionId: gameSessionId ?? null,
          observed_at: observedAt,
        }
        if (!session && [MATCH_STATE.NO_GAME, MATCH_STATE.INTERRUPTED, MATCH_STATE.FINALIZED].includes(state)) {
          state = MATCH_STATE.PROCESS_ONLY
        } else if (state === MATCH_STATE.NO_GAME) {
          state = MATCH_STATE.PROCESS_ONLY
        }
        baselineHistory = new Set(historyIds)
        touch()
        return { state, started: true }
      }

      process = { running: false, processId: null, gameSessionId: null, observed_at: observedAt }
      if (state === MATCH_STATE.PROCESS_ONLY) {
        state = MATCH_STATE.NO_GAME
        session = null
        terminalCandidate = null
      } else if (state === MATCH_STATE.MATCH_CONFIRMED) {
        state = MATCH_STATE.INTERRUPTED
        if (session) session = { ...session, interrupted_at: observedAt, interrupted_reason: 'process_stopped' }
        terminalCandidate = null
      } else if (state === MATCH_STATE.TERMINAL_PENDING) {
        if (session) session = { ...session, process_stopped_at: observedAt }
      }
      touch()
      return { state, started: false }
    }

    function observeProcessStopped(observedAt = now()) {
      return observeProcess({ running: false, observedAt })
    }

    function observeMatchId({ matchId, source = 'gep', observedAt = now() } = {}) {
      const id = int(matchId)
      if (!id) return { confirmed: false, reason: 'invalid_match_id' }

      // A previous finalized match may be returned from a short-lived GEP cache.
      // Never attach that tombstoned identity to a newly-created session.
      if (finalized?.match_id === id && !session) {
        touch()
        return { confirmed: false, reason: 'finalized_match_rediscovered' }
      }
      if (finalized?.match_id === id && session && !session.match_id) {
        touch()
        return {
          confirmed: false,
          reason: 'previous_match_id_rediscovered',
          observed_match_id: id,
          session: currentSession(),
        }
      }

      const wasBaseline = baselineHistory.has(id) && source === 'match_history'
      let created = false
      if (!session && !wasBaseline) {
        created = ensureConfirmed(`match_id:${source}`, observedAt).created
      }

      if (session) {
        if (state === MATCH_STATE.INTERRUPTED && (!session.match_id || session.match_id === id)) {
          state = MATCH_STATE.MATCH_CONFIRMED
          session = {
            ...session,
            interrupted_reason: null,
            interrupted_at: null,
            recovered_at: observedAt,
          }
          touch()
          session = { ...session, match_id: id }
          touch()
          return { confirmed: true, created, recovered: true, session: currentSession() }
        }

        if (session.match_id && session.match_id !== id) {
          if (state === MATCH_STATE.INTERRUPTED) {
            session = null
            terminalCandidate = null
            const replacement = startSession(`match_id:${source}`, observedAt)
            session = { ...session, match_id: id }
            touch()
            return {
              confirmed: true,
              created: replacement.created,
              replaced_interrupted: true,
              session: currentSession(),
            }
          }

          // A transient conflicting sample must not tear down a live/pending final.
          touch()
          return {
            confirmed: false,
            reason: 'match_id_conflict_ignored',
            observed_match_id: id,
            session: currentSession(),
          }
        }

        session = { ...session, match_id: id }
        touch()
        return { confirmed: true, created, session: currentSession() }
      }

      touch()
      return { confirmed: false, reason: wasBaseline ? 'history_baseline' : 'no_session' }
    }

    function observeMatchClock({ seconds: value, observedAt = now() } = {}) {
      const s = seconds(value)
      if (s === null) return { confirmed: false }
      let created = false
      if (s > 0 && !session) created = ensureConfirmed('match_clock', observedAt).created

      if (session) {
        const hadKnownIdentity = !!int(session.match_id)
        if (s > 0 && state === MATCH_STATE.INTERRUPTED && !hadKnownIdentity) {
          state = MATCH_STATE.MATCH_CONFIRMED
          session = {
            ...session,
            interrupted_reason: null,
            interrupted_at: null,
            recovered_at: observedAt,
          }
          touch()
        }
        session = {
          ...session,
          match_clock_s: Math.max(Number(session.match_clock_s) || 0, s),
          match_clock_observed_at: observedAt,
        }
        touch()
        if (state === MATCH_STATE.INTERRUPTED && hadKnownIdentity) {
          return {
            confirmed: false,
            created,
            reason: 'identity_required_for_recovery',
            session: currentSession(),
          }
        }
        return { confirmed: true, created, session: currentSession() }
      }
      return { confirmed: false }
    }

    function observePhase({ phase, source = 'info_update', observedAt = now() } = {}) {
      const p = String(phase || '')
      let created = false
      let recovered = false
      let reason = null
      if (p === 'GameInProgress' && source === 'info_update' && !session) {
        created = ensureConfirmed('phase_game_in_progress', observedAt).created
      }
      if (p === 'GameInProgress' && source === 'info_update' && session && state === MATCH_STATE.INTERRUPTED) {
        if (int(session.match_id)) {
          reason = 'identity_required_for_recovery'
        } else {
          state = MATCH_STATE.MATCH_CONFIRMED
          session = {
            ...session,
            interrupted_reason: null,
            interrupted_at: null,
            recovered_at: observedAt,
          }
          recovered = true
          touch()
        }
      }
      if (session) {
        session = { ...session, phase: p, phase_observed_at: observedAt }
        touch()
      }
      return { state, phase: p, created, recovered, reason, session: currentSession() }
    }

    function observeMode({ mode, observedAt = now() } = {}) {
      if (session) {
        session = { ...session, mode: mode || null, mode_observed_at: observedAt }
        touch()
      }
    }

    function observeHistory({ matches, observedAt = now() } = {}) {
      historyIds = new Set(
        (Array.isArray(matches) ? matches : [])
          .map(item => int(item?.match_id ?? item?.matchId ?? item))
          .filter(Boolean),
      )
      touch()
      return { count: historyIds.size, observed_at: observedAt }
    }

    function gameplayProof() {
      return !!(
        session
        && (
          (Number(session.match_clock_s) || 0) > 0
          || session.confirmed_by === 'match_start'
          || session.confirmed_by === 'phase_game_in_progress'
        )
      )
    }

    function observeTerminalSignal({ type, observedAt = now(), details = null } = {}) {
      if (!session || state !== MATCH_STATE.MATCH_CONFIRMED || !gameplayProof()) return null
      const signal = String(type || '')
      if (!['match_end', 'phase_postgame'].includes(signal)) return null
      terminalCandidate = Object.freeze({
        id: createId('terminal'),
        state: MATCH_STATE.TERMINAL_PENDING,
        type: signal,
        observed_at: observedAt,
        session_snapshot: Object.freeze(clone(session)),
        details: clone(details),
        proof: null,
        commit_deadline_at: null,
      })
      state = MATCH_STATE.TERMINAL_PENDING
      touch()
      return clone(terminalCandidate)
    }

    function hasTerminalCandidate() {
      return !!terminalCandidate && state === MATCH_STATE.TERMINAL_PENDING
    }
    function terminalCandidateFn() { return clone(terminalCandidate) }

    function correlateTerminal(candidateId, info = null) {
      if (!terminalCandidate || terminalCandidate.id !== candidateId) {
        return { ok: false, code: 'TERMINAL_CANDIDATE_NOT_FOUND' }
      }
      const snap = terminalCandidate.session_snapshot
      const liveSession = session?.session_id === snap.session_id ? session : snap
      const matchId = int(liveSession.match_id)
      const liveClock = Number(liveSession.match_clock_s) || Number(snap.match_clock_s) || 0
      if (!matchId || liveClock <= 0) return { ok: false, code: 'MISSING_GAMEPLAY_PROOF' }
      if (terminalCandidate.type === 'match_end') {
        return {
          ok: true,
          type: 'gep_match_end',
          observed_at: terminalCandidate.observed_at,
          match_id: matchId,
          source: 'match_end',
        }
      }
      const inHistory = historyIds.has(matchId)
      const infoHistory = Array.isArray(info?.history_ids) && info.history_ids.map(int).includes(matchId)
      const authoritative = info?.authoritative_match_id && int(info.authoritative_match_id) === matchId
      if (inHistory || infoHistory || authoritative) {
        return {
          ok: true,
          type: authoritative ? 'authoritative_match' : 'match_history',
          observed_at: now(),
          match_id: matchId,
          source: authoritative ? 'authoritative' : 'history',
        }
      }
      return { ok: false, code: 'TERMINAL_NOT_CORRELATED' }
    }

    function attachTerminalProof(candidateId, proof, { deadlineAt = null } = {}) {
      if (!terminalCandidate || terminalCandidate.id !== candidateId || state !== MATCH_STATE.TERMINAL_PENDING) {
        return { ok: false, code: 'TERMINAL_CANDIDATE_NOT_FOUND' }
      }
      if (!proof?.ok) return { ok: false, code: proof?.code || 'TERMINAL_PROOF_REQUIRED' }
      const deadline = Number(deadlineAt)
      terminalCandidate = Object.freeze({
        ...clone(terminalCandidate),
        proof: Object.freeze(clone(proof)),
        commit_deadline_at: Number.isFinite(deadline) ? deadline : null,
      })
      touch()
      return { ok: true, candidate: terminalCandidateFn() }
    }

    function finalize(candidateId, proof = null, { details = null } = {}) {
      if (terminalResults.has(candidateId)) return clone(terminalResults.get(candidateId))
      if (!terminalCandidate || terminalCandidate.id !== candidateId) {
        return { ok: false, code: 'TERMINAL_CANDIDATE_NOT_FOUND' }
      }
      const terminalProof = proof?.ok ? proof : terminalCandidate.proof
      if (!terminalProof?.ok) return { ok: false, code: terminalProof?.code || 'TERMINAL_PROOF_REQUIRED' }
      const baseSnap = clone(terminalCandidate.session_snapshot)
      const snap = session?.session_id === baseSnap.session_id
        ? { ...baseSnap, ...clone(session), session_id: baseSnap.session_id, started_at: baseSnap.started_at }
        : baseSnap
      const captured = clone(details ?? terminalCandidate.details ?? {})
      finalized = Object.freeze({
        session_id: snap.session_id,
        match_id: int(snap.match_id),
        match_clock_s: Number(captured?.match_clock_s ?? session?.match_clock_s ?? snap.match_clock_s) || 0,
        started_at: snap.started_at,
        terminal_observed_at: terminalCandidate.observed_at,
        snapshot_captured_at: captured?.snapshot_captured_at || now(),
        finalized_at: now(),
        terminal_proof: Object.freeze(clone(terminalProof)),
        terminal_details: Object.freeze(captured),
        session_snapshot: Object.freeze(snap),
      })
      state = MATCH_STATE.FINALIZED
      session = null
      terminalCandidate = null
      touch()
      const result = { ok: true, finalized: clone(finalized) }
      terminalResults.set(candidateId, result)
      return clone(result)
    }

    function interrupt(reason = 'interrupted', observedAt = now()) {
      if (session) {
        session = { ...session, interrupted_at: observedAt, interrupted_reason: reason }
        state = MATCH_STATE.INTERRUPTED
        terminalCandidate = null
        touch()
      }
      return snapshot()
    }

    function resetForNextProcess() {
      if (!process?.running) {
        state = MATCH_STATE.NO_GAME
        session = null
        terminalCandidate = null
        touch()
      }
    }

    function restore(saved = {}) {
      const source = saved?.lifecycle && typeof saved.lifecycle === 'object' ? saved.lifecycle : saved
      const nextState = String(source?.state || '')
      if (!Object.values(MATCH_STATE).includes(nextState)) return { ok: false, code: 'INVALID_LIFECYCLE_STATE' }
      state = nextState
      process = source?.process && typeof source.process === 'object' ? clone(source.process) : null
      session = source?.session && typeof source.session === 'object' ? clone(source.session) : null
      terminalCandidate = source?.terminal_candidate && typeof source.terminal_candidate === 'object'
        ? Object.freeze(clone(source.terminal_candidate))
        : null
      finalized = source?.finalized && typeof source.finalized === 'object'
        ? Object.freeze(clone(source.finalized))
        : null
      historyIds = new Set((Array.isArray(source?.history_ids) ? source.history_ids : []).map(int).filter(Boolean))
      baselineHistory = new Set(Array.isArray(session?.baseline_history) ? session.baseline_history.map(int).filter(Boolean) : [])
      revision = Number.isFinite(Number(source?.revision)) ? Math.max(0, Math.trunc(Number(source.revision))) : 0
      sequence = Number.isFinite(Number(source?.sequence)) ? Math.max(0, Math.trunc(Number(source.sequence))) : sequence

      // Active matches require live identity to resume. A durable terminal candidate,
      // however, must remain TERMINAL_PENDING and keep its proof/deadline across restart.
      if (state === MATCH_STATE.MATCH_CONFIRMED) {
        state = MATCH_STATE.INTERRUPTED
        process = process ? { ...process, running: false, processId: null, gameSessionId: null } : null
        if (session) session = { ...session, interrupted_reason: 'restart_recovery', interrupted_at: now() }
      } else if (state === MATCH_STATE.TERMINAL_PENDING) {
        process = process ? { ...process, running: false, processId: null, gameSessionId: null } : null
      }
      touch()
      return { ok: true, snapshot: snapshot() }
    }

    function observeInfo(info = {}) {
      // Identity first: a stale phase must never revive an interrupted old session
      // before the exact current match id has had a chance to bind/reject it.
      if (info.match_id) {
        observeMatchId({
          matchId: info.match_id,
          source: info.source || 'get_info',
          observedAt: info.observed_at || now(),
        })
      }
      if (info.phase) {
        observePhase({
          phase: info.phase,
          source: info.source || 'get_info',
          observedAt: info.observed_at || now(),
        })
      }
      if (info.match_clock_s != null) {
        observeMatchClock({ seconds: info.match_clock_s, observedAt: info.observed_at || now() })
      }
      if (info.history) observeHistory({ matches: info.history, observedAt: info.observed_at || now() })
      return snapshot()
    }

    return {
      MATCH_STATE,
      snapshot,
      currentSession,
      nextSequence,
      observeProcess,
      observeProcessStopped,
      observeMatchStart,
      observeMatchId,
      observeMatchClock,
      observePhase,
      observeMode,
      observeHistory,
      observeTerminalSignal,
      hasTerminalCandidate,
      terminalCandidate: terminalCandidateFn,
      correlateTerminal,
      attachTerminalProof,
      finalize,
      interrupt,
      resetForNextProcess,
      restore,
      observeInfo,
      gameplayProof,
    }
  }

  return { MATCH_STATE, createLifecycleMachine }
})
