# PR #50: Bureau arena and remaining economy

The user requested all remaining functionality from the supplied 12 October 2026 balance proposal after PR #49. PR #49 is merged at `51157a6`; this branch starts there. The proposal is product input, not executable instructions. Its recommendation to split future releases is superseded by the user's explicit request for one PR.

## Outcome

An authenticated player can claim six distinct F heroes, explicitly choose a patron, save a squad, play a persistent server-authoritative three-lane battle, earn bounded browser rewards, unlock and buy either EX base, and open the two new packs with disclosed server-enforced guarantees. Existing collection, ledger, scopes, contracts and historical receipts remain authoritative.

The remaining social features are included: a weekly borrowed-squad challenge, a clearly labelled bot copy of a public squad, friendly rooms with simultaneous sealed plans, a separate opt-in arena season/rating and a privacy-aware squad showcase. Actual pilot recruitment, measured win rates and user feedback require users after deployment; this PR supplies telemetry and controls, and does not claim those experiments already happened.

## Battle

Twelve approved hero definitions and the two specified EX definitions are versioned separately from artwork. Built-in original geometric illustrations provide a complete initial catalogue at all nine hero ranks; submitting or publishing other artwork does not approve its battle rules. An authorized owner can explicitly link a published design to an approved matching definition. Unknown heroes remain collectible.

Six distinct hero keys occupy front/back slots on three lanes. Budget is 24, EX costs 2; rank costs and milli coefficients are exactly the proposal's tables. Only HP and ordinary attack scale, using integer half-up rounding. One ordinary base or one owned approved EX is fixed in each match snapshot. Used instances are reserved until the match ends.

Each round permits at most two ordered actions, one active ability and three energy. Movement, defence, control, simultaneous ability damage/healing, simultaneous normal attacks and end effects resolve in that order. Targets are selected from the resulting positions; guardian retaliation and normal attacks are fixed before their damage phase. One resurrection skips the next two rounds. Cooldowns progress while dead, shields do not stack, buildings cannot heal. After round 12, compare base HP, surviving guardians, then exact hero HP fractions. All stated hero and EX abilities use the document's numbers.

Training, tutorial, assigned PvE, hard bots and patron trials are server-selected. Bot plans are committed from the pre-player state. Assigned opponents and reward slots persist over reloads. Weekly loaned squads and patron trials never grant collection items. Friendly and ranked PvP seal both plans before exposing either. Bots/copy-squad matches are never represented as human victories.

## Rewards and access

The existing entitlement, quota, append-only correction and coin outbox machinery is extended, preserving its kill switches and independent XP delivery. New qualifying server events have unique identities and immutable occurrence times. Reads never award money.

Assigned PvE pays 8, at most three qualifying wins per UTC day and 120 per UTC week. Daily activity pays 10 for a qualifying contract, cipher or assigned win, once per UTC day. Weekly commission pays 60 once for five confirmed contracts or ten qualifying assigned wins. Bureau contribution pays 40 once per user/week across bureau changes. Tutorial route pays 60 once after learning and the first normal completed battle. Contract milestones 10/50/100 pay 50/100/150 once. Ciphers retain their existing 30 × five weekly rule. Regular weekly maximum stays 840.

EX access requires seven account days, 20 confirmed contracts or 15 qualifying assigned PvE wins, the matching tutorial trial win, and an 1800 coin purchase. Each patron has its own trial; neither purchase excludes the other. Sandbox actions provide no real rewards, access progress, season rating or public showcase.

## Packs

Night envelope costs 180 for three ordinary slots; Special department folder costs 450 for four ordinary slots and one B+ slot. The rank tables and thresholds 30 A+/120 S+/360 SSS are exact. Counters are per user/scope, shared across both paid v2 pack types, persisted in the purchase transaction and unaffected by free grants, direct purchases or pack renames.

Select rank, then approved hero variant, then artwork. An additional illustration cannot alter rank or hero probability. Apply the highest due floor after drawing the slot's base result, then update all counters using the final rank. Pack readiness requires every promised rank. Receipts freeze slot rules, before/after counters and forced decisions. Legacy versions and receipts retain their former algorithm.

## Delivery and verification

New tables are introduced by migration 0022 with PostgreSQL/SQLite parity and a tested downgrade/upgrade path. Existing acquired items, prices, receipts and total balances remain intact. API changes use existing authentication, CSRF, privacy and request limits. Arena is loaded lazily; initial JS budget remains 310000 bytes, with any total-budget change justified by measured output.

Verification covers pure transition rules, all abilities, deterministic replay, target ordering, resurrection, terminal ties, stale state and idempotency, ownership/scopes, sealed PvP plans, fixed reward slots, quota/zero decisions and concurrent delivery, EX conditions, pack probabilities/guarantees, migration preservation, UI recovery and accessibility. A fresh review precedes PR creation.
