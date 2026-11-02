# Ritual Contracts Implementation Plan

> Agentic workers: use Superpowers execution and verification. Each worker owns its bounded files; no shared-index commits or subagents.

**Goal:** Complete the requested site redesign and open a reviewable PR.
**Architecture:** Preserve React/FastAPI integration and authentication, replace public composition and private shell, share a new Ritual style system. Daily packs reuse existing inventory and persisted server receipts.
**Tech Stack:** Existing React 19, TypeScript, Vite 8, FastAPI, SQLAlchemy, Alembic.
**Spec:** docs/superpowers/specs/2026-11-02-ritual-contracts-design.md

## Global constraints
- Full visible redesign across public and authenticated shell; RU/EN and mobile.
- No Arena, coins/history, cipher or public catalogue; daily packs only.
- Server confirmation before signing success; reduced motion and keyboard access.
- Keep legacy storage/admin access. Work on redesign/ritual-contracts-20261102; never merge/deploy.

## Review focus
- Multiple concurrent daily requests and response loss cannot grant twice.
- Empty pool cannot consume today's entitlement.
- Old direct URLs cannot resume retired coin/cipher/arena operations.
- Signing network errors preserve selection and cannot show false success.
- Account changes and midnight rollover refresh daily status correctly.

## Tasks
- [x] Backend daily pack entitlement, transaction retirement, migration and behavior tests.
- [x] Authenticated shell / collection simplification and route behavior tests.
- [x] Scroll signing composition, real receipt, video lifecycle and keyboard behavior tests.
- [x] Public landing/pages, modern global visual system, supplied/new assets and reference documentation.
- [x] Integrate, build, full suites and independent review.
- [x] Record browser visual/interaction QA blocker; no visual verification claim.
- [ ] Commit and open new PR.
