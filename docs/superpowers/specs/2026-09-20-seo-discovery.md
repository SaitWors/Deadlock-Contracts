# PR41: public discovery

The user requests a complete SEO improvement in PR41. The supplied “SEO / Indexing: Было → Должно стать” audit is the starting point. Google’s JavaScript SEO and localized-version guidance and OpenAI’s crawler documentation were checked on 2026-09-20.

## Outcome

Visitors and crawlers get useful, visible product information without running JavaScript or calling an authenticated API. The same Russian/English copy appears in React. Links identify real documents. Unknown URLs return 404. Private information stays private.

## URL contract

- Product documents: `/ru/`, `/en/`, and each language’s `contracts`, `how-it-works`, `cards`, `about`, `leaderboard`, `try`, `campaigns`.
- `/` remains the existing Steam-return/dashboard entry. Its public HTML is Russian and canonicalizes to `/ru/`; logged-in visitors retain the dashboard. Explicit language URLs always show public content, including for logged-in visitors.
- Unprefixed product routes, legacy `how`/`leaderboards` aliases and redundant trailing slashes permanently redirect to the appropriate document. Legacy public hashes navigate to documents; private dashboard hashes retain their meaning.
- Trials and unfinished campaigns are accessible but `noindex,follow` and excluded from the sitemap. Public player dossiers remain `noindex`; missing/private dossiers return 404 without exposing identities.
- Existing legal, support, status, changelog and data-source documents remain reachable. Their selected article must be visible without JavaScript; localized documents have their own metadata.

## Implementation decisions

Use FastAPI HTML rendering around the built Vite shell and a shared JSON content catalog; no new framework/dependencies. Replace the older decorative “how” presentation with the shared readable guide while preserving the home design, contract preview, leaderboard and pack mechanics. Rendered HTML is identical for bots and people and contains no private/session data.

Each indexable document has a unique title/description, canonical, reciprocal RU/EN hreflang, OpenGraph/Twitter fields and factual WebSite/WebPage structured data. URLs derive only from configured APP_BASE_URL. Use existing project artwork for a stable social image; no invented reviews/ratings. Escape HTML/JSON. No per-request lastmod or generated keyword pages.

Public React content appears while `/api/me` runs. Session failure leaves the content available with an honest retry notice. Public navigation and language switching are real links. The current design and fixed asset budgets remain in force.

Serve robots and a deterministic sitemap; allow search crawlers including OAI-SearchBot to public documents, keep API/reviewer/auth routes excluded. IndexNow is optional and disabled without a valid key, with an explicit dry-run/submission command restricted to sitemap URLs. It is not called automatically on every deployment/request. No indexing guarantees, no changes to production DNS, private-repository visibility, or search-console accounts. Provide owner instructions and reusable public project copy. llms.txt is optional supporting documentation only.

## Acceptance

Raw GET/HEAD responses, multilingual links/content, redirects, 404s, private-profile behavior, host/query injection safety, API failure, authenticated entry and asset shipping have tests. Existing frontend/backend suites, formatting, types, build, release checks and GitHub CI pass. Publish a new PR; do not merge or deploy it.
