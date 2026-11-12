# Contract journey: design and UX contract

The research-led iteration keeps the existing Ritual bureau identity and improves
the path from choosing a goal to understanding its result. The primary action is
choosing and signing a contract. The collection is a secondary return visit, not
a replacement for that action.

## Design ownership

- `appearance.css` and `appearance-state.ts` remain the source of theme, contrast
  and motion preferences. Reuse their `--ns-*` tokens and existing Inter / Oracle
  typography; introduce no new fonts, artwork, icon libraries or theme system.
- `guest-journey.css` owns only the public demo board and its selection dock.
- `contract-board.css` owns the private board, its compact cards and the new
  verification / personalization disclosures.
- `public-content.css`, `collection-preview.css` and
  `community/leaderboard-clarity.css` own their named public components.
- Standalone status and data-source documents use `nightshift-documents.css`
  and the existing document appearance preferences.

Keep one clear accent for selection and the primary action. Use text, icons and
structure alongside colour. Explanations belong close to their object; detailed
rules remain available through native disclosure controls. Do not add autoplay,
decorative counters, new canvas effects or another animation dependency.

## User-visible guarantees

1. A guest can choose one to three contracts, see the count and potential XP
   while scrolling, release a slot and try signing. Demo selection never creates
   a real contract or awards XP. Changing the selected mode resets the example
   selection; reselecting the same radio does not.
2. The dock stays inside the board and respects the device safe area. Keyboard
   focus on a card must remain visible between the header and dock. Corrective
   scrolling is immediate and only responds to keyboard focus, not selection by
   pointer or re-rendering.
3. Signing preserves the existing keyboard, Escape, focus return, saved autograph,
   reduced-motion and animation skip behaviours. Game modes use shared readable
   RU/EN labels in the demo and agreement.
4. Active cases show one server-derived status and next step. Spent attempts,
   waiting for a source, verification and review never imply failure. Attempt
   limits come from the board. No invented ETA or verification percentage.
5. Personalization is explained only from supplied metadata. A matching metric
   and target in `basis` are required before claiming an adapted goal. Empty
   metadata, cold start and general variety goals are distinct cases.
6. Pending history entries are visually neutral; an existing single evaluation
   is still available in the log. Server decisions and the XP ledger remain the
   authority. A result may use an allowed provider or Companion settlement path.
7. Collection examples come only from the current available published daily
   pool. They are examples, not promised draws, and reveal no inventory, odds,
   balances or unpublished cards. The public image route rechecks eligibility.
   The retired catalogue stays retired. The daily reset is 00:00 UTC with a
   local rendering of the server's next reset time.
8. A leaderboard shows its objects before its detailed explanation. Its XP is
   explicitly leaderboard-eligible XP, distinct from profile total XP; completed
   contracts are labelled as all-time even when the XP period changes. Scope
   changes reset pagination. Do not duplicate the same players in a podium.
9. Loading must finish with data, an honest empty state or a retryable error.
   Resource requests have a deadline; late replies cannot replace a new request.
   Status refresh retains focus and does not submit duplicate requests.
10. Public status describes server-reported configuration, not an independent
    uptime measurement. Do not show an old editorial date as live status. Unknown
    component values remain unknown; no incidents published is not proof that
    none occurred.

## Review and acceptance

- Run the full frontend suite, TypeScript, formatter, production build and asset
  budget. Run public preview backend tests and the full backend/release checks.
- Review both languages, all existing theme preferences and reduced motion.
- Browser checks: 320, 390, 768 and 1440 px, narrow-screen overflow, sticky dock,
  keyboard selection, limit/release, dialog open/close and demo confirmation.
  Verify keyboard focus against actual bounding rectangles, not JSDOM layout.
- Inspect collection examples and the ranking's empty and populated states.
  Test failed and hanging requests in deterministic component tests.
- Keep previews, databases and screenshots outside the release payload. Local
  preview accounts and mock matches do not verify real Steam or live settlement.

## Explicitly deferred

There is no generic product analytics collector in the current frontend. This
iteration does not introduce third-party tracking or pretend that local events
measure retention. Funnel measurement needs a defined first-party event schema,
retention policy and cohort baseline before claiming an effect.

Weekly summaries need complete server aggregates, rather than a partial history
page. Compatibility recommendations need structured condition validation. Neither
should be inferred from display copy or incomplete client data. Guilds, the
reward economy, live settlement policies and existing signature / reward effects
are outside this UI iteration.
