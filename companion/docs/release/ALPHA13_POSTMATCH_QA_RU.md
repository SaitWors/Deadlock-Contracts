# Alpha.13 — обязательная post-match QA матрица

Эта матрица выполняется **после** зелёного `npm run release:check` и установки exact OPK `0.5.2-alpha.13` (`manifest 0.5.2.13`) через Overwolf Developer Options / test channel.

Цель: подтвердить на реальном Deadlock, что исправления finality/queue/recovery работают при реальном порядке GEP events/info updates.

## 1. Обычный полный матч

1. Запустить Companion до Deadlock.
2. Убедиться, что pairing активен и GEP READY.
3. Начать Standard матч.
4. Зафиксировать Session ID и появившийся Match ID.
5. Завершить матч обычным способом.
6. В первые 5 секунд после `match_end` не закрывать Companion.
7. Проверить diagnostics/log:
   - появился terminal proof;
   - состояние прошло через `TERMINAL_PENDING`;
   - final snapshot был создан только при commit;
   - final попал в durable queue;
   - после ACK queue очистилась;
   - на сайте case перешёл к provider verification.

PASS: один `match_ended`, правильные Session ID/Match ID, ненулевые финальные roster-поля при наличии их в GEP, нет duplicate final.

## 2. Exit сразу после match_end

1. Сыграть тестовый матч до конца.
2. Сразу после `match_end` нажать явный Exit Companion.
3. Запустить Companion снова.
4. Проверить queue/diagnostics и сайт.

PASS: terminal packet не потерян. После рестарта нет состояния «матч локально finalized, но durable final отсутствует».

## 3. Crash/restart внутри grace window

1. Завершить матч.
2. В течение 1–3 секунд после `match_end` аварийно закрыть/перезапустить Companion/Overwolf test app.
3. Запустить снова с сетью.

PASS: восстановлены terminal candidate + proof + deadline; final создаётся/доставляется один раз.

## 4. Offline на конце матча

1. До `match_end` отключить сеть либо сразу после terminal signal заблокировать доступ к backend.
2. Дождаться final commit.
3. Убедиться, что final остаётся локально в durable queue.
4. Перезапустить Companion при необходимости.
5. Восстановить сеть.

PASS: final доставляется после reconnect; `IN_FLIGHT` после crash/restart не зависает навечно, idempotent retry не создаёт второго final.

## 5. Две игры подряд без restart

1. Завершить матч N.
2. Не закрывая Companion, сразу начать следующий матч N+1.
3. Отслеживать Session ID, Match ID, outcome/team/mode/clock/evidence.

PASS:
- новая session имеет новый Session ID;
- Match ID N не привязывается к session N+1;
- при кратком появлении старого cached Match ID он отклоняется как previous-final tombstone;
- реальный Match ID N+1 принимается;
- K/D/A/damage/outcome/team/mode/clock предыдущего матча не протекают в новый.

## 6. Match ID появляется поздно

Нужен реальный случай или GEP simulator/recorded trace, где `match_started` уже создан, но exact Match ID приходит позже.

PASS: start и final имеют один causal `session:<Session ID>`; final не обходит незавершённый predecessor даже если start был с `match_id=null`, а final уже с exact ID.

## 7. Outcome раньше Match ID

Нужен simulator/recorded trace или реальный лог с ранним `match_outcome`.

PASS: outcome сначала сохраняется как session-bound pending outcome; после exact Match ID marker получает этот ID и не переносится в соседнюю session.

## 8. Standard / Ranked / Street Brawl

Выполнить минимум один lifecycle каждого режима.

Standard/Ranked PASS: режим на overlay/desktop и отправленный payload совпадает с GEP mode.

Street Brawl PASS:
- `PostGame` между раундами не создаёт whole-match final;
- evidence накапливается по scoring-session;
- partial/lower roster update не уменьшает уже накопленные метрики;
- окончательный terminal event создаёт один final.

## 9. Overlay / hotkey / window lifecycle

Проверить:
- Ctrl+Shift+C show/hide;
- rebind hotkey;
- fullscreen/borderless/windowed;
- Alt+Tab;
- 1366x720 @100%, 1920x1080 @125%, 3840x2160 @150% по возможности;
- desktop X только скрывает окно и не убивает background;
- явный Exit корректно обрабатывает pending final.

## 10. Ads

На текущем production backend ads feature должна оставаться выключенной до отдельного Overwolf QA.

Если тестируется OwAd path, реклама допускается только в desktop safe state и не должна показываться в gameplay overlay/FTUE/pairing/error/empty state.

## 11. Сбор доказательств

Для каждого сценария сохранить:
- Companion diagnostics;
- timestamp;
- Session ID (можно редактировать при публикации);
- Match ID;
- queue state до/после reconnect;
- screenshot desktop/overlay при необходимости;
- server request ID/статус, если есть ошибка.

## Stop-ship

Не отправлять Alpha.13 в QA/Beta, если обнаружено хотя бы одно:
- потеря `match_ended`;
- final замораживается до late roster/outcome внутри grace;
- final обходит start той же session;
- persisted `IN_FLIGHT` остаётся вечным;
- вторая игра получает Match ID первой;
- restart обнуляет evidence той же session;
- Street Brawl PostGame завершает всю scoring-session;
- клиент самостоятельно выдаёт final XP/verdict без server verification.

## Отдельно после Alpha.13

Arbitrary-late evidence после bounded grace не считается решённым. Для этого нужен отдельный cross-repo контракт `match_enriched` и server-side revision/requeue logic.
