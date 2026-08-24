# Deadlock Contracts 0.10.1-alpha.8

Дата кандидата: 24 августа 2026 года.

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
- Регистрация и первый job контракта выполняются атомарно; активный кейс
  защищён уникальным ограничением и безопасным восстановлением stale-состояний.
- Companion evidence остаётся диагностическим: verdict и XP вычисляет только
  серверный provider/evaluator; клиентские timestamps ограничены и не являются
  доверенным источником времени.
- Rate limit стал общим для web workers через Redis; proxy headers принимаются
  только от явно доверенных сетей.
- Admin получил outbox health, просмотр неизменяемого payload/error и
  аудируемый replay dead-letter событий.

## Release gate

CI проверяет backend, frontend, PostgreSQL migrations
и production Docker image, dependency audits, release contents и
воспроизводимость Companion OPK/CycloneDX SBOM. Hero-изображение
оптимизировано, а рост JS/CSS/графики ограничен CI-budget.
GitHub Actions и Docker/Compose base images закреплены неизменяемыми commit/digest.

## Публичный интерфейс

Landing daily-board теперь явно является интерактивным preview.
Выбор ничего не сохраняет и не создаёт настоящий контракт.

Footer ведёт на реальные Privacy, Terms, Support,
Status, Changelog и Data Sources.

## Companion

Каноническая версия-кандидат:
`0.5.2-alpha.6`, manifest `0.5.2.6`. Она построена поверх присланной и
подтверждённой рабочей alpha 5; provenance и hash базы сохранены.

## Обязательный follow-up перед Overwolf

Автоматические проверки закрыты, но exact OPK всё ещё должен пройти
реальный Windows/Overwolf/Deadlock QA, testing channel и антивирусную
проверку до submission.

Защита от stale previous-match evidence не ослабляется.
