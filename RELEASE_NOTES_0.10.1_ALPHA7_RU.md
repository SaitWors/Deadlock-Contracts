# Deadlock Contracts Web/Backend 0.10.1-alpha.7

## Result correlation hotfix

Исправлен кейс, при котором матч уже был найден и основные итоговые показатели присутствовали, но контракт на победу уходил в `VERIFYING / REVIEW_REQUIRED` из-за отсутствующего `summary.result`.

Новый путь использует результат Overwolf GEP только когда одновременно доказаны:

- точный текущий Match ID;
- совпадение Steam identity;
- terminal evidence (`match_end` или доверенный session end) того же матча;
- отдельный `match_outcome` info-update, записанный Companion Evidence v7 именно для этого Match ID;
- известная команда локального игрока.

Обычное значение `match_outcome`, полученное через `getInfo`, по-прежнему диагностическое: оно может быть stale от предыдущего матча.

Если Deadlock API уже отдал canonical result, он имеет приоритет при конфликте.

## Faster verification

Early exact-metadata retry schedule сокращён до:

`3, 5, 8, 12, 20, 30, 45, 60, 90, 120, 180, 300 s`.

Частые ранние попытки выполняются сначала через cache/S3 путь с `disable_steam=true`. Дорогой Steam fallback не превращён в polling и остаётся ограниченным.

## Startup repair

Добавлена новая generation idempotency keys для повторного подхвата старых `VERIFYING / REVIEW_REQUIRED` дел после обновления. Уже сыгранный матч со старым Companion может закрыться автоматически, если canonical provider metadata стала доступна; если старый клиент не записал Evidence v7 и provider всё ещё не знает result, безопасно угадать победу сервер не будет.

## Open Beta deploy

`preflight.sh` и `deploy-current.sh` теперь валидируют как Closed Alpha, так и Web Open Beta. Reviewer gateway запрещён при открытом Steam login.
