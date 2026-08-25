# Deadlock Contracts 0.10.1-alpha.9

Дата кандидата: 25 августа 2026 года.

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
- Исправлен legacy source merge: свежий ответ `deadlock_api` очищает все
  потенциально клиентские GEP stats/capabilities перед записью, а поздний GEP
  больше не может обогатить независимый provider match.
- Любой provider label из семейства Companion/GEP блокируется evaluator даже
  при старом `is_final=true` и сохранённой duration.
- History API пагинируется по `ContractBoard`, возвращает целые cases и
  совместимый плоский `items`; сайт больше не разрезает одно дело на страницах.
- Offline-очередь Companion pin-ит `match_started` вместе с `match_ended`.
- Для первого QA рекламный контейнер выключен на всё время работы процесса
  Deadlock, включая lobby/loading/post-game; stale/unknown state остаётся closed.

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
`0.5.2-alpha.7`, manifest `0.5.2.7`. Она построена поверх присланной и
подтверждённой рабочей alpha 5; provenance и hash базы сохранены.

## Обязательный follow-up перед Overwolf

Автоматические проверки закрыты, но exact OPK всё ещё должен пройти
реальный Windows/Overwolf/Deadlock QA, testing channel и антивирусную
проверку до submission.

Защита от stale previous-match evidence не ослабляется.
