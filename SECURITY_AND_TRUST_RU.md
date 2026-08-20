# Безопасность и модель доверия

## Источник истины

Backend — единственный источник истины для доски, выбранных option IDs, lock time, режима, попыток, expiry, результата contract evaluation и XP ledger. Браузер, Companion и overlay не имеют endpoint для отправки готового verdict или произвольного XP.

Desktop API возвращает нормализованное серверное состояние:

- `GET /api/desktop/v1/bootstrap` — пользователь, Companion status и все три доски;
- `POST /api/desktop/v1/boards/lock` — проверенный server-side lock 1–3 option IDs;
- `POST /api/desktop/v1/boards/{mode}/reroll` — server-side policy и лимит reroll.

Live telemetry помогает определить факт/фазу матча, но считается предварительной. Окончательная проверка использует итоговые post-match данные. Если capability/данных недостаточно, контракт не помечается поражением автоматически: создаётся internal review.

## Аутентификация

- Web: Steam OpenID, server-side session, HttpOnly/Secure/SameSite cookie и CSRF для mutations.
- Companion: привязанное устройство и Bearer token; token нельзя писать в log, screenshot, crash report или localStorage web-страницы.
- Admin: роль на сервере плюс TOTP elevation. Reviewer gateway не выдаёт admin rights и действует только в ограниченное QA-окно.
- Closed Alpha allowlist и reviewer code — разные механизмы. Reviewer code хранится только как SHA-256.

## Production-защита

- TLS завершает Caddy; HTTP перенаправляется на HTTPS.
- PostgreSQL находится только во внутренней Docker network.
- Web/worker работают non-root, с read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, лимитами CPU/RAM/PID.
- OpenAPI/docs, demo auth и dev endpoints отключены.
- Security headers включают CSP, HSTS, frame protection, MIME protection, referrer и permissions policy.
- Шрифты и frontend assets self-hosted; runtime-зависимости от Google Fonts нет.
- Provider raw payload не сохраняется в production по умолчанию.
- Evidence имеет отдельный volume, лимиты размера/числа файлов и retention.

## Секреты

Релизный ZIP не содержит `.env.production`, `secrets/`, database dump, backup или runtime data. Production values хранятся в отдельных файлах `secrets/*.txt`, монтируемых Compose как read-only secrets. Не отправляйте их в Git, мессенджеры, тикеты или QA-архив.

Минимальная ротация при компрометации:

1. Ограничить доступ к VPS и сохранить audit/log evidence.
2. Ротировать session secret — это завершит активные сессии.
3. Ротировать Steam/Deadlock API keys и webhook credentials.
4. Отключить reviewer gateway или заменить reviewer code hash.
5. Перезапустить web/worker и проверить `/api/status`, logs и reward ledger.

## Честные ограничения alpha.1

- Доступность итоговых данных зависит от community provider.
- Companion не гарантирует наличие каждого GEP-поля в каждой версии Deadlock.
- Web fallback поддерживает доски и post-match pipeline, но лучший pre/in-game UX находится в Companion.
- XP не влияет на официальный rank Deadlock и не имеет денежной стоимости.
- Проект не связан с Valve Corporation.

## Responsible disclosure

Используйте `CONTACT_EMAIL` из `/api/status` и страницы `/support`. Не публикуйте рабочий exploit, token или чужие данные до исправления.
