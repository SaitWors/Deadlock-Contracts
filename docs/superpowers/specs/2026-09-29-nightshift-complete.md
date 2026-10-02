# Nightshift throughout the product

The user supplied `Deadlock_Contracts_Nightshift_Docker (1).zip` as the approved visual reference. PR43 retained too much legacy layout and styling. This follow-up must bring every existing screen, signing flow and Companion window into that reference, preserving all working behavior.

## Visual contract

- Use the reference's calm graphite/mint surfaces, Inter body and section headings, condensed display type only for large art heroes, generous spacing, 22 px panels, 12 px controls, subtle borders and shadows.
- Preserve all five website themes and the existing mascot's three natural poses. Use existing local scene artwork; no substitute character and no fake statistics or demo handlers in production.
- Desktop product layout follows the reference: brand at the top of the sidebar, compact top bar, clear page headings, integrated hero/stats and useful visual sections. Mobile retains all destinations.
- Contracts become rounded information cards with readable targets, rewards, filters and clear selection. Active/history/profile/leaderboard/achievements/public documents/help all use the same components.
- Archive, card frames, studio, envelopes, cipher and receipt/modal surfaces share the new design. Preserve rarity identity, user artwork, user-selected bureau/profile decoration and genuine transaction flows.
- Admin: all 16 sections, including empty, detail, edit and confirmation states. Group controls coherently, use readable table/list rows and compact filter bars. Preserve identifiers, permission checks, API payloads and draft state.
- Signing: a polished modern contract dossier inside a rounded dialog, explicit review/acknowledgment/signing/result states, legible selected terms, real reward totals, accessible signature input and stamp animation. Never suggest success before the API confirms. Keep failure recovery, focus, pending and duplicate-submit guards.
- Companion: desktop, onboarding/pairing, contracts, verification/history, diagnostics/settings, announcements and compact overlay. Apply the same local fonts, semantic palette and rounded controls while preserving Overwolf window controls, game/input rules, pairing, ads constraints, protocol, queue and evidence handling. Overlay stays unobtrusive and respects existing interaction restrictions.

## Validation

- Reuse behavioral tests and add tests only for changed interaction logic; don't write snapshot tests for cosmetic selectors.
- Compare screenshots of populated and empty views at desktop and 360/390 px, light/dark/black/custom modes, RU/EN, reduced motion.
- Exercise all 16 owner admin sections and restricted role behavior; keep draft/filter state.
- Build and run frontend/backend/Companion checks; verify OPK and Docker through CI.
- Publish a new PR against current main (PR43 is merged). Do not deploy or merge automatically.
