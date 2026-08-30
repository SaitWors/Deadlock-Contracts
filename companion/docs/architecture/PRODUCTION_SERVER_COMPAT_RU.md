# Совместимость с текущим production

Проверенный production snapshot: web `0.10.1-alpha.10`, Git SHA `c2d9402`, desktop API `desktop.v1`, bootstrap `schema_version: 1`.

Текущий сервер принимает `CompanionHeartbeatRequest` со `extra=forbid`. Поэтому Alpha.9 **не отправляет** напрямую внутренние поля Evidence v8 (`schema_version`, `terminal_proof`, `sequence`, `idempotency_key`, `device_id`, `observed_at`). Они остаются в зашифрованной локальной causal queue. `src/server-compat.js` проецирует событие на точный production heartbeat v1 allow-list.

Идемпотентность текущего backend поддерживается через стабильный `client_event_id`; Alpha.9 формирует его детерминированно из локального idempotency key.

`interrupted` является локальным lifecycle-состоянием и на текущий backend передаётся как `game_stopped` с `session_end_reason=interrupted`, что не является scoring final.

Scoring final отправляется как `event_type=match_ended` только после локального terminal proof и `match_clock_s > 0`; `session_ended_at` и `session_end_reason` вычисляются из immutable terminal snapshot.

Bootstrap schema 1 и будущая schema 2 поддерживаются одновременно. Не повышать production minimum version до Alpha.9 до завершения Windows QA.
