# Advertising and Overlay policy — 0.5.2-alpha.6

- Единственный рекламный контейнер `400×60` находится в Desktop HQ.
- В Overlay, FTUE, pairing, dialog, error/empty state реклама не создаётся.
- До свежего подтверждения игрового состояния действует fail-closed; при `GameInProgress` контейнер уничтожается.
- Используется Overwolf Managed Ads SDK, без собственного iframe и без самостоятельной загрузки creative.
- Реальная выдача рекламы и соответствие policy должны быть подтверждены Overwolf QA.
