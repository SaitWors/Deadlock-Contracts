# Deadlock Contracts 0.10.1-alpha.8

Дата: 22 августа 2026 года.

## Надёжность

- Усилен suspended-account lifecycle.
- Усилен Companion principal lifecycle.
- Pending pairing codes инвалидируются при suspension.
- PostgreSQL schema changes переведены на Alembic.
- Добавлен отдельный migration step.
- Outbox получил retries, backoff и dead-letter handling.

## Release gate

CI проверяет backend, frontend, PostgreSQL migrations
и production Docker image.

## Публичный интерфейс

Landing daily-board теперь явно является интерактивным preview.
Выбор ничего не сохраняет и не создаёт настоящий контракт.

Footer ведёт на реальные Privacy, Terms, Support,
Status, Changelog и Data Sources.

## Companion

Каноническая версия:
`0.5.2-alpha.4`, manifest `0.5.2.4`.

## Known follow-up

`summary.healing` и часть terminal `summary.result`
требуют отдельного reliability fix.

Защита от stale previous-match evidence не ослабляется.
