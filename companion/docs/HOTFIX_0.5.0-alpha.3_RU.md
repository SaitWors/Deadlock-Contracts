# Companion 0.5.0-alpha.3 — post-game hotfix

## Причина

После корректного `PostGame`/`match_end` Deadlock GEP может кратко вернуть для того же Match ID последовательность `Init → GameInProgress`, а `game_mode` — пустое/`NONE` значение. В alpha.2 финальная сессия уже не открывалась заново, но recovery poll и повторный terminal event могли несколько раз поставить `match_ended` в очередь и засорить diagnostics.

## Исправление

- Tombstone хранит точный финализированный Match ID и session ID.
- Для того же Match ID post-final фазы `Init`, `WaitingForPlayersToJoin`, `PreGameWait`, `GameInProgress` игнорируются; финальный snapshot не стирается.
- `game_mode` того же финализированного матча не заменяет сохранённый режим.
- `match_ended` имеет стабильный upload key `<match_id>:<session_id>` и ставится в persistent queue один раз.
- Если Companion был offline, финальный snapshot ставится в очередь после успешного reconnect/pairing.
- Tombstone очищается только при появлении другого валидного Match ID; новый матч получает новую сессию.

## Что не менялось

Клиент не рассчитывает финальный verdict, не меняет статус assignment и не начисляет XP. GEP healing остаётся provisional в Overlay. Сервер `0.10.0-alpha.2` самостоятельно решает, можно ли использовать финальный Street Brawl scoreboard snapshot.

## Регрессия

Fixture использует обезличенный Match ID `100180758`, фазы и числовую статистику. Имена и SteamID других игроков в тестовые данные не включены.
