# UX contract

## Product context

Deadlock players choose match objectives, review and sign their conditions, then view verified progress and collections. Public information remains accessible without a session. RU/EN copy and accessible names follow the active route/locale. Preserve the existing UTC reset policy and localized presentation. Accessibility target: WCAG 2.2 AA.

## Business-context sources

This redesign changes presentation and public navigation. It does not change authentication, permissions, contract lifecycle, match trust, rewards or collection data. Business rules remain with their maintained documentation and server implementations:

| Scope | Sources |
|---|---|
| Selection, signing and recovery | `docs/design/STAGE1_RU.md`, `app/services/boards.py`, `frontend/src/contract-signing.ts` |
| Verified progress and reward provenance | `docs/development/critical-personal-progress-validation.md`, `app/services/evaluator.py`, `app/services/progression.py` |
| Coins and collection | `docs/development/contract-coins-stage1.md`, `app/services/coin_rewards.py`, `app/services/archive_packs.py` |
| Authentication and permissions | `SECURITY_AND_TRUST_RU.md`, `app/services/auth.py`, `app/services/permissions.py` |
| Public copy, metadata and legal documents | `shared/public-pages.json`, `app/seo.py`, `app/static/legal.html`, `app/static/legal_en.html` |

## Visual contract

`DESIGN.md` records the digital graphite direction. `frontend/src/appearance.css` remains the canonical runtime token source, with `appearance-state.ts` applying dark, light, black, custom and system preferences. Standalone documents mirror those roles through `app/static/nightshift-documents.css` and `document-appearance.js`. This document adds no competing token definitions.

## Canonical UI map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | Existing feature form and `SignatureField.tsx` | Server validation and field state | Existing native controls; no validation behavior migration in this redesign | Existing signing, archive, community and admin suites |
| Scrollbar | `frontend/src/appearance.css` | `DESIGN.md` and semantic scrollbar tokens | Document gutter; component geometry exceptions | Computed styles at desktop/mobile; forced-colors override |
| Toast | `frontend/src/announcements/AnnouncementProvider.tsx`, `AnnouncementLayer.tsx` | Existing session/surface eligibility and revision identity | Existing announcement tones and dismissal rules | Announcement tests and accessible live-region review |
| Public navigation | `frontend/src/public-navigation.tsx`, `BureauHeader.tsx` | Server page payload, metadata and committed route | Public enhancement; private/auth/legal/native-link exceptions | `frontend/tests/public-navigation.test.mjs`, `frontend/tests/seo.test.mjs` and browser history/locale checks |
| Signing | `frontend/src/ContractSigning.tsx`, `SignatureField.tsx`, `contract-signing.ts` | Authoritative current board and server response | Preview and real signing; typed and drawn signatures | Existing signing/workspace suites and keyboard/browser checks |

## Navigation and responsive behavior

Eligible unmodified same-origin public anchor clicks use `PublicNavigationProvider`. It validates the destination's `dc-public-page` payload before updating route copy, language, title, descriptions, robots, canonical/alternate links, social metadata and structured data. The existing page stays visible while pending; navigation exposes busy/status feedback. New requests abort obsolete ones; failed or timed-out enhancement falls back to normal document navigation.

Successful transitions update history; Back/Forward reads the corresponding server document. Committed routes scroll to the requested fragment or page top. Do not promise preservation of the previous route's scroll position. Keep auth/private destinations, the session-sensitive bare `/`, external/download/targeted links, modifier clicks and same-page fragments native. Direct visits and no-JavaScript documents remain complete.

`BureauHeader` keeps the active underline within its owning item. The narrow menu uses `aria-expanded`/`aria-controls`, closes after navigation and on Escape, and returns Escape focus to its toggle. Appearance and locale actions remain reachable. Do not introduce a second public router or screen-specific header behavior.

## Signing, focus and recovery

Selection remains bounded to the existing contract limit. Preview signing stays explicitly labeled, creates no real case and awards no XP. Real signing blocks duplicate submissions and shows success only after a validated server receipt. The cosmetic seal never establishes success. Preserve stale-selection errors, uncertain-response recovery and the selected terms after a recoverable failure.

`ContractSigning` owns the native modal dialog, heading focus, background scroll lock, pending-state close restrictions, reduced-motion completion and restoration to a visible enabled trigger or brand fallback. `SignatureField` owns text/draw switching, undo/clear, bounded strokes and account-scoped browser persistence; failed local storage does not prevent signing. Preserve the typing alternative to drawing.

## Feedback and async states

Keep actionable errors inline; use shared announcement content for system messages. `AnnouncementProvider` and its layer own eligibility, ordering, dismissal/acknowledgment and queued receipts. Dismissible noncritical announcement toasts hide after the existing 12-second interval; critical/required messages retain their existing policy. Do not add a parallel screen-local toast system or use browser alert/confirm/prompt dialogs.

Preserve meaningful pending, empty, failure, stale and confirmed states without moving primary controls. Semantic controls, visible focus and readable contrast must survive theme changes, long RU/EN copy and reduced motion. This contract does not replace server authorization or grant new mutation behavior.

## Verification

Check runtime token/standalone drift and lint `DESIGN.md` after design changes. Relevant frontend coverage lives in `frontend/tests/public-navigation.test.mjs`, `seo.test.mjs`, `document-appearance.test.mjs`, `legal.test.mjs`, `legal-navigation.test.mjs` and `signing.test.mjs`; run these from `frontend/`. Backend crawler coverage is `tests/test_seo.py`.

For runtime changes, also run the repository's TypeScript, formatter, production build and frontend budget checks. Exercise direct and enhanced routes, Back/Forward, native link exceptions, slow/failing transitions, keyboard/menu/signing focus, RU/EN, narrow/desktop layouts, every appearance mode and reduced motion in a real browser. Existing tests and source inspection do not substitute for browser geometry or live Steam provider verification.


## Case completion

`app/services/case_completion.py` and authenticated `GET /api/boards/{board_id}/completion` own the result receipt. Only the owner can read it; selected task verdicts and trusted XP ledger delivery determine readiness. The endpoint is read-only and private/no-store. It does not acknowledge, settle, enqueue rewards or mutate progression. The replay start is a projection ending at the current actual balance, not a historical balance assertion; subsequent profile corrections may reduce the displayed refill while actual case XP remains factual.

The stable `CompletionProvider` in `frontend/src/case-completion/CompletionButton.tsx` owns the frozen open case, module-load failure/retry and per-session replay labels. Board polling, day rollover and tab navigation do not replace an open result. Entries exist on the settled board, in completed cases and in history. The dialog owns cancellable receipt fetch, retryable pending/error feedback, keyboard focus/scroll restoration and animation state. Skip and automatic completion move focus from the disappearing playback control to Done; Replay moves it back to Skip. Closing/replaying/refreshing never awards XP.

Success cards animate actual trusted XP sequentially, crossing each server-authored band separately even after delayed frames. Final failed/void/expired tasks retain distinct labels; unresolved review/provider tasks never play a failure scene. Escape first skips playback, then closes the static result; the close control can dismiss immediately. System/manual reduced motion immediately finishes visual playback. Announce task outcomes and level changes rather than each numeric frame.
