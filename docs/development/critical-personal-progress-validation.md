# Critical repairs and personal progress: validation

## Repository and compatibility

The implementation is based on GitHub main `8db85642ae30e38142b95f4cc281c93c7dec1082` (tree `7cee3eb304a749ff0019bc0cf47da33e16bca020`). Main was checked again during implementation and remained unchanged. Read-only public HTTP checks of `/api/health` and `/api/status` returned 200 and web `0.10.1-alpha.12`, agreeing with source metadata. These endpoints do not expose a deployed Git SHA or establish schema/worker correctness. Runtime source hashes were compared with the repository before changes. Backend, frontend and production Compose target web `0.10.1-alpha.12`; Companion metadata and manifest agree on `0.5.2-alpha.18` / `0.5.2.18`. This is a review branch, not a released version.

The private read model is additive: `/api/personal-progress`, version `personal-progress-1`, and the optional desktop capability `personal_progress_v1`. Existing clients continue using the established bootstrap fields. Companion hides the new private projection for cached, stale or unpaired snapshots. No database migration, new currency, hero XP or settlement rollout is introduced.

## Critical behavior

| Audit finding | Behavior after the change | Regression evidence |
| --- | --- | --- |
| C-02: old evaluation overwrites a newer attempt | Dispatcher and evaluator require the exact current bound match. Locked board/options/review rows refresh cached ORM state. Historical review remains scoped to its own assignment. | Four original replay tests failed before the fix; a further long-lived-session regression failed before cached state refresh. Both are covered in the passing backend suite. |
| C-01: heartbeat changes finalized evidence | Final v9 evidence remains immutable; scoring verifies the canonical digest and lease/account/device/session/match identity, then reads final facts. Missing final metrics stay missing. | Final mutation, hash drift, missing metric, identity and cached-session regressions failed before the fixes. |
| INFRA-01: restart strands RUNNING jobs | Normal polling reclaims expired/orphaned leases. Separate-session heartbeat renews live jobs; owner and attempt fence completion/retry. | Four orphan/renewal/ownership regressions failed before implementation. Queue delivery remains at least once and domain handlers still require idempotency. |
| INFRA-02: restore drops live DB before validating the archive | Private archive validation and a trial import/runtime check precede service interruption. Cutover retains the original DB and verifies OIDs; uncertain/failing cutover attempts identity-based rollback. Services resume explicitly. | 13 real-script tests use controlled Docker/psql failure paths, real gzip/checksum and filesystem cleanup. Real PostgreSQL rehearsal is still required. |

The finalized GEP path remains client-attested, without independent provider verification. Its rollout settings remain disabled by default. Already-corrupted historical final evidence is rejected; this branch does not automatically repair production data.

## First product increment

The website provides one existing recommended goal and up to two alternatives for practice, experiment, result or variety. Mode and board generation are checked before opening the existing signing flow, and lock uses a fresh server board. Account/mode/intent changes abort obsolete requests and clear the previous private result.

The debrief uses the latest final SCORED match and up to 20 previous matches of the same source, preferring the same hero when enough history exists. The current match never enters its own baseline. Known current values remain visible during calibration; comparison medians/deltas require eight prior known values. Missing values are omitted or shown as unavailable. XP comes from the existing owned reward ledger, attributed once to the actual final completion match.

Hero dossiers contain recent eligible match counts, completed contracts and factual records. They explicitly retain mode and source information. Hero names fall back to `Hero #ID`; mastery levels, hero XP, campaigns and community competitions are later work.

Colors and typography use the existing appearance tokens and Jost/Ruslan Display. Actions use orange, improvement uses sage, calibration uses amber and data/source information uses cyan. RU/EN, keyboard tab operation, narrow website layouts and reduced motion are supported in the new components. Companion retains its existing desktop layout and theme system.

## Verification

- Backend: `python -m pytest -q -p no:cacheprovider` — **559 passed; 1188 subtests passed**.
- Critical Python CI lint: `python -m ruff check app alembic tests scripts --select E9,F63,F7,F82` — passed. Python compile and `scripts/release_check.py .` — passed. The repository's wider advisory lint rules have existing findings; no blanket clean-lint claim is made.
- Restore: `python -m pytest -q tests/test_restore_safety.py` — **13 passed**; `bash -n scripts/restore.sh` — passed.
- Companion: `npm run release:check` — **128 unit/integration/contract tests passed**, syntax, RU/EN invariants, user-facing catalog, 204 contrast token pairs and release metadata checks passed.
- Companion standalone packaging: `npm run test:qa-bundle` — **2 passed**, including reproducible standalone source/OPK, checksums and metadata mismatch rejection.
- Companion DOM behavior runs under the frontend's existing jsdom dependency; its five scenarios passed. Companion CI and standalone packaging remain dependency-free.

- Website: `npm test` — **166 passed**, including the Companion DOM scenarios; TypeScript `tsc --noEmit`, full frontend `oxfmt --check`, production Vite build and diff whitespace check — passed.
- Website asset budget — passed: total JavaScript **720,823 / 725,000 bytes**, initial JavaScript **301,364 / 310,000**, CSS **426,138 / 450,000**, largest image **356,200 / 600,000**, all assets **2,502,565 / 3,100,000**. Duplicate home goal/KPI/mode-card markup was removed while retaining the paper XP/profile entry, active-case shortcut, mascot, recovery note and archive/artwork. Home deduplication saved 3,196 bytes; final terminal-state handling added 1,037 bytes, leaving the clean production build 2,159 bytes smaller than the first implementation. The total cap increases by 10,000 bytes (1.4%) to accommodate the new private feature; the public entry, CSS, image and overall asset caps are unchanged. No dependency or payload guard was removed to reach it.

## Whole-branch review and fix pass

A fresh read-only reviewer inspected the complete branch at `d306119`. Two Important findings were reproduced and fixed by the author in one pass:

1. A reclaimed discovery handler could use cached LOCKED rows and rebind a case that its replacement had already advanced or completed. Two regressions use actual claim/expiry/reclaim calls and two sessions; they failed before refreshing the board and selected options under the binding locks. They now preserve the replacement's VERIFYING or SETTLED state, binding, attempts, evaluation/outbox/job counts, and reject completion by the old owner.
2. Settled goals were shown as locked and awaiting results, and a completed selection could hide a remaining active goal. Three backend regressions failed before selected-active priority was added. Eight RU/EN DOM regressions failed before terminal-state rendering: completed, failed, expired and void goals now show factual status, remain unsignable, hide the merely offered XP and open the debrief. Debrief labels retain terminal states and display actual awarded XP. Existing active-case/signing behavior remains covered.

The final full suites passed after this fix pass: backend 559 plus 1188 subtests, website 166 and Companion 128. Type/format/production-build/budget, critical Python lint/compile and release checks also passed. The reviewer reported no additional Critical findings or deferred Minor findings. No second reviewer cycle was used.

## Scope decisions and limits

- Keep existing AUTH-01/02 and dependency advisories for the next audit group. They remain known work; this PR must not be treated as clearing the whole audit.
- Keep durable GEP queue, permanent-final retries and underlying mixed-source settlement repairs for the next group. Source labeling was checked here; the existing delivery limitations remain.
- Keep other provisioning/readiness repairs outside this increment. Public release/status responses do not establish deployment readiness.
- Keep hero XP, campaigns, community competitions, expanded achievements and richer filtering for later phases. These are not present in this first factual progress foundation.
- Make no production PostgreSQL/Compose correctness or concurrency claim; require isolated rehearsal before production use. A passing command double cannot exclude runtime failures.
- Make no real browser/mobile/assistive-technology or Overwolf claim; require their QA before release. Headless DOM tests do not exclude layout/native/telemetry issues.
- Publish changed entries on the original complete remote Git tree and verify the omitted local unused PNG by its original blob SHA. A reconstructed local snapshot must never replace the whole remote tree.
- Permit the bounded total JavaScript cap adjustment noted above; retaining all existing initial/CSS/image/overall-asset caps limits the tradeoff to up to 10,000 additional bytes across all lazy JavaScript.

## Checks before production use

No Docker/PostgreSQL runtime or browser executable is available in this development environment. SQLite, Node/jsdom and controlled command doubles do not prove PostgreSQL locking/authentication/cutover, real browser/native dialog layout, screen-reader behavior, or Overwolf/in-game telemetry. Before deploying, rehearse restore using disposable pinned Compose images, perform browser/mobile RU/EN/theme checks and run the Companion Overwolf QA matrix. No production restore, deployment, merge or GEP enablement was performed.

The remaining P2/P3 audit findings are outside this first increment. Next groups are authentication/rate-limit and dependency advisories, then durable GEP queue and mixed-source behavior, then provisioning/readiness and remaining UX/accessibility. The home XP display also now follows the refreshed progression ledger (FE-03).
