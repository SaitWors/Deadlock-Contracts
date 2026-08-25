# Deadlock Contracts Companion 0.5.2-alpha.7

Первый pre-public QA candidate на базе последней рабочей alpha 5.

## Главное

- Данные GEP/heartbeat остаются только диагностическим сигналом: итог контракта и XP выдаёт исключительно сервер по подтверждённому provider match.
- Обе границы lifecycle — `match_started` и `match_ended` — не вытесняются heartbeat при переполнении offline-очереди; повторная доставка идемпотентна и использует bounded exponential backoff.
- При любой смене Match ID очищается состояние прошлого матча, включая outcome, team и clock.
- Диагностический лог редактирует roster/Steam identifiers; overlay получает компактный snapshot без сотен log-записей.
- Реклама создаётся только в Desktop HQ после свежего подтверждения, что Deadlock не запущен; весь lifecycle процесса игры и неизвестное/устаревшее состояние действуют fail-closed.
- Динамический пользовательский текст, ошибки, названия и описания контрактов доступны на русском и английском.

Alpha 7 не подменяет alpha 5: хэш исходной рабочей базы сохранён в `COMPANION_SOURCE_PROVENANCE.json`.
