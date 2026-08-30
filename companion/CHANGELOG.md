# 0.5.2-alpha.16

- Presence heartbeat now continues every 15 seconds while paired even when no match session is active, so website presence no longer drops in menus or immediately after a match.
- Pairing, reconnect and network recovery register authenticated presence immediately.
- Match evidence heartbeat/finality semantics remain unchanged; presence carries no client scoring authority.

# Deadlock Contracts Companion — Changelog

## 0.5.2-alpha.13 — post-match finality hardening

- Final GEP evidence is no longer frozen at `match_end`; terminal proof opens a bounded 5-second collection grace for late roster, match outcome, match id and clock updates.
- `TERMINAL_PENDING` candidate/proof/deadline is checkpointed and restored after restart; explicit Exit force-commits a proven terminal packet before the background root window closes.
- Durable queue persistence now happens before lifecycle transitions to `FINALIZED`, eliminating the crash window where the session was closed but no final upload existed.
- Queue causal identity is anchored only to immutable `session_id`; an unknown `match_id` at start and exact `match_id` at end remain in one FIFO.
- Queue schema v3 recovers persisted `IN_FLIGHT` items as immediate `RETRY_WAIT` while preserving their old idempotency key for safe ACK-loss retry.
- New-session state reset prevents the previous finalized Match ID/outcome/team/mode/clock from leaking into the next match, while same-session restart recovery preserves evidence.
- `getInfo` snapshots process exact Match ID before phase recovery, and an interrupted session with a known Match ID cannot be revived by phase/clock alone.
- Outcomes observed before Match ID are first bound to immutable `session_id` and rebound to the exact Match ID when identity arrives.
- Evidence schema remains v8 and production heartbeat remains `companion-heartbeat.v1`; no server trust boundary or XP authority moved to the client.

## 0.5.2-alpha.12 — merged QA candidate

- Combined the strongest parts of both Alpha.12 branches: modular evidence/focus selection, Street Brawl round-aware accumulation, live Active Case refresh, conflict-safe match IDs, and shared progress-driven completion effects.
- Fixed Street Brawl live evidence flicker: partial/null roster fields no longer erase known match values.
- Match evidence correlation is anchored to immutable `session_id`, so a late or transiently conflicting `match_id` cannot reset or interrupt a confirmed live session.
- Street Brawl counters and match clock accumulate across round epochs instead of only taking the largest single-round sample.
- Street Brawl `PostGame` is treated as a round boundary rather than synthetic proof that the entire scoring session ended.
- Desktop Active Case rerenders on evidence revisions without requiring a full product refresh.
- Overlay evaluates every condition of every selected contract instead of always using the first contract/first condition.
- Recent relevant activity (kill/assist/damage/etc.) temporarily brings the matching condition into the primary overlay card with sticky focus to prevent visual thrash.
- Compound contracts such as Win + Hero Damage show the measurable live objective while keeping `match.win` pending until a terminal/server verdict exists.
- Completion/progress effects are driven by shared progress semantics instead of the obsolete `MET` state name.
- Deadlock mode normalization evaluates the complete GEP `game_mode` payload with precedence Street Brawl > Ranked > Standard.
- Active Case never falls back to Standard while another live mode is detected; conflicting contract locks fail closed.
- Unselected locked-board options use the production-supported `SKIPPED` non-scoring state.
- Explicit lifecycle state machine: process/window exit is not match end; terminal evidence is immutable and local final scheduling is exactly once.
- Causal upload FIFO, retry/dead-letter isolation, legacy Alpha.8 quarantine, stale-GEP fail-closed behavior, and production web 0.10.1-alpha.9 compatibility are preserved.
- RU/EN contract logic remains locale-invariant and release checks verify schema, UI strings, accessibility contrast, package identity, and safety invariants.
