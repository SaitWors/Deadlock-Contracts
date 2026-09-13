# Visual reset and archive reveal

The owner asks for a professional visual review of the live site and a gacha-like pack opening. Browser inspection on 2026-09-13 confirms an oversized uppercase landing headline, three competing primary actions, a black rectangular hero image background and a desktop navigation/menu breakpoint mismatch. The public creator profile also shows a cover partly hidden behind the fixed header and mismatched shared styling; its bureau link returns a guest to the landing screen. Authenticated screens have not been inspected in this browser. Source inspection shows that pack opening is currently a static receipt with a single fade-in of all cards.

## Direction

Keep the bureau identity: ink-green surfaces, warm white text, muted mint for navigation/actions, brass reserved for archive currency and card rarity. Use a quieter header, readable body typography, purposeful spacing and consistent rounded surfaces. The landing explains two activities (verified match contracts and browser ciphers/collections); one primary guest action, a secondary Steam action and a separate contract example. No invented activity counters, unsupported rewards or new business rules.

The pack shop should show its actual cover card, real price, draw count and available composition. A cover is an illustration, never a promised drop. Existing purchase requests, revision conflicts, saved request keys and recovery remain authoritative.

## Opening

After the server returns a receipt for a pack, offer a cinematic reveal from that receipt only. Sealed envelope → brief opening transition → individual cards → complete result. Use the existing SVG seal and real CardPreview; rarity changes the accent, not the outcome. Explicit next/skip/close controls, keyboard operation, focus restoration and reduced-motion support. No auto audio, endless flashing, fake near-misses or timers that force the user to watch. History and non-pack receipts display immediately. Replaying presentation never requests a purchase. New receipt identities reset presentation correctly; unmount cleans up timers/listeners.

## Limits and acceptance

No backend/economy/permission changes or new animation dependencies. Keep frontend budgets. Replace owning styles instead of piling another general override stylesheet onto the cascade. Test paid-request idempotency, receipt identity, skip/close/replay/reduced-motion and receipt recovery. Build an offline fixture using real components for all ranks and long names, including a 320 px layout. Record honestly which screens were visually reviewed and which still require browser QA; a jsdom test is not visual proof. Deliver a new PR, without deploying or merging.
