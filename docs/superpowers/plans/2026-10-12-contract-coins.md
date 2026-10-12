# Contract coins and economic foundation implementation plan

> **For agentic workers:** Use the development and verification skills to implement each independently testable task below.

**Goal:** Deliver stage 1 of the supplied Deadlock Contracts balance proposal in PR #49: trustworthy contract coins and a safe, separate test economy.

**Architecture:** Preserve the existing ARCHIVE_TOKEN ledger and collection. Snapshot monetary policy when contracts are signed, reserve UTC quotas at final settlement, and deliver durable entitlements independently of XP. Separate REAL and SANDBOX operations and inventory, and introduce forward-only prices without rewriting purchase receipts.

**Tech stack:** FastAPI, SQLAlchemy, Alembic/PostgreSQL, React/TypeScript.

**Spec:** User-supplied `Deadlock_Contracts_Card_Game_Balance_2026-10-12 (1).md`, sections 10, 11, 14–17. The user explicitly selected the first release stage; arena combat, EX, pack guarantees, PvE and seasons are subsequent releases.

## Global constraints

- STANDARD/RANKED: LIGHT 6, FOCUSED 10, HARD 16, EXTREME 24; STREET_BRAWL pays half.
- Contract coins including case bonus: 80 per UTC day, 400 per UTC Monday week.
- Case bonus: 10 (5 STREET_BRAWL), requires at least two signed contracts, all completed.
- Final independent server facts only. No demo, mock, GEP-only, historical unsnapshotted or incomplete reward.
- Unique monetary rights do not depend on policy version. Persist partial and zero decisions.
- New direct prices: 25/40/70/120/220/380/700/1300/2600 for F through SSS.
- Preserve old receipts, cost bases and combined monetary balances 1:1. Test provenance must not produce competitive REAL assets.
- Keep frontend budget and migration checks.

## Review focus

- Duplicate and delayed events, including XP delivered before coin activation.
- Pending delivery through coin kill-switch and transaction rollback.
- Historical test funds converted into purchases and mixed-funds operations.
- Debt, scoped refunds and last-copy checks.
- Immutable pack history and forward-only repricing.

## Tasks

- [x] Contract rewards: signing snapshots, independent-evidence eligibility, quota reservation, durable coin event, delivery, receipts and append-only corrections; tests for replay, zero decisions and missing trust.
- [x] Wallet scopes: REAL/SANDBOX ledgers, operations and items; scoped purchase/grant/refund and credit versus spending validation; regression tests for debt and cross-scope duplicates.
- [x] Migration 0021: schema parity, preserved existing data, historical test-money provenance and new active pack versions; migration preservation and concurrency checks.
- [x] UI: local reset times, coin receipts and quota explanations, available balance/debt and explicit test-wallet selection; existing purchase recovery retained.
- [x] Validate backend/frontend suites, type check, format, production build and budgets; fresh code review, fix material findings, create PR #49.

## Decisions

- The existing task-owned clean checkout is used on `codex/contract-coins`, based on current `origin/main` (5382607).
- Earlier historical OWNER grants are separated with a deterministic chronological provenance migration. Any purchase requiring test funds is SANDBOX, including a mixed-funds purchase; paired scope transfers preserve the original combined balance and old receipts.
- Existing active legacy packs receive new immutable price versions. Typed slots and pity guarantees remain stage 5 and are not advertised by this release.
