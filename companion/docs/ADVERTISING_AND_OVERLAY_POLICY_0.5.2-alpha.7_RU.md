# Advertising and Overlay policy — 0.5.2-alpha.7

- Единственный рекламный контейнер `400×60` находится в Desktop HQ.
- В Overlay, FTUE, pairing, dialog, error/empty state реклама не создаётся.
- До свежего подтверждения игрового состояния действует fail-closed; пока процесс Deadlock запущен, контейнер уничтожен во всех фазах, включая lobby/loading/post-game.
- Используется Overwolf Managed Ads SDK, без собственного iframe и без самостоятельной загрузки creative.
- Реальная выдача рекламы и соответствие policy должны быть подтверждены Overwolf QA.
