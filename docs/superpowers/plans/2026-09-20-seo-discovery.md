# Public discovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Deadlock Contracts discoverable through useful server-rendered public documents, while keeping the authenticated product intact.

**Architecture:** FastAPI renders metadata and readable fallback content into the built Vite shell. A shared JSON catalog supplies the same content to React. Explicit RU/EN document URLs, native links and bounded redirects replace public hash navigation.

**Tech Stack:** Python/FastAPI, React/TypeScript/Vite, pytest, node:test/jsdom; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-seo-discovery.md`

## Global Constraints

- Keep the existing Steam-return/dashboard root behavior, legal routes and private hashes.
- Product language URLs override saved/browser language; public copies never depend on cookies or `/api/me`.
- Keep existing frontend asset budgets and CSP. No bot-specific content, fake ratings or guaranteed indexing claims.
- Do not merge, deploy, change DNS, publish a public repository or submit to search consoles in this PR.

## Review Focus

- Session timeout and an already authenticated visitor on a public URL: readable content stays public.
- Missing/private profiles and arbitrary paths: 404, no leaked identity, no cacheable personalized HTML.
- Host/query/script-like content: canonical URLs stay on configured origin and HTML/JSON stays escaped.
- Production Vite/Docker output: fallback is visible, assets exist, metadata is not duplicated.
- Old hash links, trailing slashes and language preferences: one canonical destination, no loops or broken dashboard navigation.

### Task 1: public server documents

**Files:** `shared/public-pages.json`, `app/seo.py`, `app/main.py`, `Dockerfile`, `frontend/index.html`, `tests/test_seo.py`.

**Interfaces:** shared catalog keys are page IDs `home`, `contracts`, `how`, `cards`, `about`, `leaderboards`, `try`, `campaigns`; each entry has `slug`, `index`, `ru`/`en` records with `label`, `title`, `description`, `heading`, `intro`, `sections: [{heading, text}]`. Python `public_path(page, language)` maps IDs to document paths; `resolve_public_path(path)` returns `(page, language, redirect)` or None. `render_public_page(page, language, base, shell)` returns HTML. `render_document(...)` supplies common metadata for legal/private/error documents.

- [x] Add raw-response tests before implementation, including the following contract:
  ```python
  response = client.get('/en/contracts')
  assert response.status_code == 200
  assert '<html lang="en"' in response.text
  assert 'rel="canonical"' in response.text
  assert 'Contracts for Deadlock' in response.text
  assert client.get('/not-a-real-page').status_code == 404
  assert client.head('/en/contracts').status_code == 200
  ```
- [x] Run `/tmp/dc-seo41-venv/bin/python -m pytest tests/test_seo.py -q`; expect failures for missing metadata/404 behavior.
- [x] Implement catalog, renderer, routing and build copies. Use `html.escape(..., quote=True)` for text/attributes and `json.dumps(...).replace('<', '\\u003c')` for JSON-LD. Render only the selected legal article. Root remains public HTML; profiles use existing visibility rules and `no-store`.
- [x] Run the SEO tests and backend suite; expect all passing. Commit task 1.

### Task 2: public React navigation and resilience

**Files:** `frontend/src/publicRoutes.ts`, `frontend/src/PublicContent.tsx`, `frontend/src/App.tsx`, `frontend/src/Landing.tsx`, `frontend/src/BureauHeader.tsx`, `frontend/src/i18n.tsx`, `frontend/src/bureau.css`, `frontend/tests/seo*.{tsx,mjs}`, affected first-visit/signing tests.

**Interfaces:** consumes task 1 catalog; `publicUrl(page, language)` and `resolvePublicRoute(path)` mirror server route mappings. Landing wraps its content in a forced-language provider; private Dashboard retains the ordinary provider. Header items optionally contain `href`, retaining button callbacks for private navigation.

- [x] Write behavior tests for pending/rejected `/api/me`, explicit public routes with an authenticated response, RU/EN override, real navigation hrefs, legacy public-hash mapping, and preservation of private hash navigation.
  ```js
  assert.match(document.body.textContent, /Deadlock/)
  assert.equal(document.querySelector('a[href="/en/cards"]').textContent, 'Cards')
  assert.equal(document.documentElement.lang, 'en')
  ```
- [x] Run the new node tests; expect the old loading/error screen and hash-only header to fail.
- [x] Render the shared catalog in React, replace static how/campaigns markup, keep functional previews. Only a confirmed valid session renders Dashboard on `/`. Unknown paths never become a dashboard. Preserve retry/error notice without hiding public copy.
- [x] Run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec oxfmt --check src tests vite.config.ts package.json index.html`, `pnpm build`, and `python ../scripts/check_frontend_budget.py dist`; expect all green with unchanged budgets. Commit task 2.

### Task 3: discovery tools and delivery

**Files:** `app/seo.py`, `app/config.py`, `compose.prod.yaml`, `.env.production.example`, `scripts/submit_indexnow.py`, `tests/test_seo.py`, `tests/test_indexnow.py`, `docs/SEO.md`, `docs/public-project.md`, README link.

**Interfaces:** consumes canonical indexable URLs from task 1; IndexNow exposes only a configured `[A-Za-z0-9-]{8,128}` key at its root filename, and submits only canonical sitemap URLs to the fixed IndexNow endpoint on an explicit command.

- [x] Test sitemap language pairs/exclusions, robots rules, empty/invalid IndexNow configuration, key response, dry run and HTTP submission responses before adding implementations. Inject HTTP transport in script tests; never submit live in tests.
- [x] Run targeted pytest; expect missing endpoints/commands to fail.
- [x] Implement discovery endpoints and explicit submission script. Document Google/Bing domain verification, sitemap, URL inspection, launch checks and measuring indexed pages. Prepare factual public project copy without creating another repository.
- [x] Run full frontend/backend gates; commit task 3 and request one fresh review of the whole branch. Fix findings with regression tests.
- [ ] Publish PR41 on the verified real main tree and inspect CI, including production-image asset checks, for that exact head.
