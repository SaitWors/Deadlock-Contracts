# Critical fixes and first personal progress flow

> **For agentic workers:** Use `superpowers:executing-plans` for the coordinator's dependent tasks and `superpowers:dispatching-parallel-agents` for independent evidence and restore domains. Complete every task without waiting for a second approval of this authorized scope.

**Goal:** Fix the four P1 findings reproduced against main `8db85642ae30e38142b95f4cc281c93c7dec1082`, then expose personal match goals, a factual debrief and a first hero dossier in the existing product.

**Architecture:** Keep FastAPI, SQLAlchemy, the existing worker queue, contract evaluator, rewards ledger and React/Companion clients. Recommendations select existing server-issued board options; accepting a goal uses the existing board signing/lock flow. A private read model derives progress from final scored matches and owned evaluations. No new currency, duplicate settlement pipeline or new database schema is required for this first increment.

**Tech Stack:** Python/FastAPI/SQLAlchemy; PostgreSQL production and SQLite regression tests; React 19/TypeScript/Vite; Companion JavaScript; Bash restore; pytest and Node/jsdom tests.

**Spec:** `docs/design/personal-progress-spec.md` (approved concept). This increment implements the first session/debrief/hero foundation; campaigns, hero XP and community competitions remain later work.

## Global constraints

- Repository base is the latest main, unchanged since the audit. Preserve every existing remote asset when publishing via Git data API.
- Reproduce each P1 with a failing behavioral regression before modifying its implementation.
- Final GEP evidence is immutable and integrity checked; client telemetry never becomes independent provider verification.
- Evaluations can only affect options bound to that exact historical match. A replay must leave a newer attempt and its rewards untouched.
- Reclaim orphaned jobs periodically; protect legitimately running handlers with renewable ownership.
- Restore validates/trial-loads before stopping applications and preserves the previous database for rollback.
- Progress is private to the authenticated account. Filter mode, exclude unfinished/unscored matches, omit unknown metrics, compare against prior matches, and expose provenance/sample size.
- Preserve current Jost/Ruslan Display typography, mascot and appearance tokens. Use accent orange for actions, sage for success, amber for waiting, cyan for data and existing theme variables for all backgrounds/text.
- Support RU/EN, narrow screens, keyboard operation and reduced motion. Goal selection must not silently change an already locked case.
- Do not enable GEP rollout, deploy, merge or change production data as part of this work.

## Review focus

1. Replay attempt A after binding B: no new evaluation or outbox event for A; B can still complete (`tests/test_stale_evaluation.py`).
2. Late heartbeat/final missing metric/tampered hash: final settlement reads only canonical final facts (`tests/test_final_evidence_integrity.py`).
3. Recent orphan becomes reclaimable after lease expiry; renewed/owned jobs cannot be completed by a stale worker (`tests/test_job_recovery.py`).
4. Corrupt gzip/checksum or failed trial restore does not stop/drop production; cutover failure restores original name (`tests/test_restore_safety.py`).
5. Progress never leaks another account, mixes modes, invents missing values, uses the latest match in its own baseline or accepts an unoffered goal (`tests/test_personal_progress.py`, frontend/Companion behavioral tests).

---

## Tasks

- [x] 1. Baseline and interfaces: run the existing backend/frontend/Companion suites, record pre-existing failures; inspect adaptive profiles, history/evaluation ledger, provenance and existing signing flow. Commit the approved design and this scoped plan.
- [x] 2. Exact-match settlement: write/run RED replay tests for dispatcher and evaluator, implement the exact binding guard in `app/services/evaluator.py` and `app/worker.py`, preserve exact-match review refresh, run settlement/queue regressions.
- [x] 3. Final evidence: independent worker owns `app/services/companion.py`, `app/services/gep_settlement.py` and `tests/test_final_evidence_integrity.py`; reproduce final mutation, isolate/protect finalized evidence, reject hash drift and missing final facts, verify existing GEP tests. Coordinator integrates any worker-side integrity use.
- [x] 4. Job recovery: write/run RED orphan/renewal/ownership tests, add reclaim/renewal in `app/services/jobs.py`, call periodic recovery in worker maintenance and protect long processing; verify retry/dedup/lifecycle suites.
- [x] 5. Safe restore: independent worker owns `scripts/restore.sh`, `tests/test_restore_safety.py` and a focused restore runbook. Test controlled Docker/psql failure paths; implement validation, trial DB, preserved old DB and rollback before claiming safety.
- [x] 6. Progress backend: write/run RED tests in `tests/test_personal_progress.py`; implement `app/services/personal_progress.py` and authenticated routes, selecting existing board options for four intents with one recommendation/two alternatives; return prior baseline comparisons and factual hero records with source tags. Add the same read model to desktop bootstrap with a capability flag. Verify read-only/privacy/mode/missing data cases.
- [x] 7. Progress clients: use typed `frontend/src/progress/` components and CSS in current tokens. Add session goal UI to home, debrief and hero dossier; reuse Dashboard signing and progress data. Companion consumes the capability and displays factual debrief/hero summary. Write/run behavioral tests for signing, language, locked boards, delayed responses, empty/error/retry and missing metrics.
- [ ] 8. Integration: run relevant suites, frontend production build/typecheck, Companion verification and release checks. Review final diff with a fresh reviewer, resolve material issues, then re-run affected checks. Publish a branch/PR based on the original main, with concrete behavior/validation and remaining limitations. Do not merge/deploy.

## Verification ledger

Record actual commands/results and scoped changes in `docs/development/critical-personal-progress-validation.md` after checks finish. Keep intermediate logs outside the repository. No production PostgreSQL restore or Overwolf in-game claim can be made from a mocked/SQLite test.
