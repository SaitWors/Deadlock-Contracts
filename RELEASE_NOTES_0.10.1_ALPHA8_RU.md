# Deadlock Contracts 0.10.1-alpha.8

Дата: 22 августа 2026 года.

## Надёжность

- Усилен suspended-account lifecycle.
- Усилен Companion principal lifecycle.
- Pending pairing codes инвалидируются при suspension.
- PostgreSQL schema changes переведены на Alembic.
- Добавлен отдельный migration step.
- Outbox получил retries, backoff и dead-letter handling.
- Ложный pre-game `match_end` больше не становится финалом только
  из-за фазы `PostGame`: требуется gameplay proof.
- Production deploy теперь запускает Alembic migration до
  пересоздания web/worker и останавливается при ошибке миграции.
- FastAPI и python-multipart обновлены до проверенных актуальных версий;
  dependency audit добавлен в CI.

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
`0.5.2-alpha.5`, manifest `0.5.2.5`.

## Обязательный follow-up перед Overwolf

Автоматические проверки закрыты, но exact OPK всё ещё должен пройти
реальный Windows/Overwolf/Deadlock QA, testing channel и антивирусную
проверку до submission.

Защита от stale previous-match evidence не ослабляется.
