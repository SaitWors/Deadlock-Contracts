# Deadlock Contracts Companion 0.5.2-alpha.18

## Canary hotfix

- K/D/A uses absolute Overwolf roster values; kill/death/assist events are
  activity hints only and can no longer double-count.
- Contract lock/reroll remains available while Deadlock is open; the immutable
  attempt lease at real match start remains the anti-retroactive cutoff.
- A running match with no selected contracts shows a compact live statistics
  dashboard in the overlay.
- Short GEP stale periods keep the last-known match dashboard visible with a
  warning instead of replacing it with an empty card.
- Managed GEP matches no longer launch the legacy Deadlock API auto-resolver.
- Audit reconciliation no longer reports an existing PENDING retry as newly
  queued every minute.
- Deadlock API remains non-authoritative asynchronous audit.
- Evidence schema remains v9.
