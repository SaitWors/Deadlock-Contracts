# Deadlock Contracts Companion 0.5.2-alpha.16

QA-кандидат поверх проверенного Alpha.15.

## Изменения

- сохранение `hero_id` локального игрока из документированного Deadlock GEP roster;
- UI различает локально сохранённый матч, ожидание независимого provider verdict и следующий матч в durable server queue;
- удалены временные forensic-диагностики salts и лишнее QA-логирование;
- устаревшие внутренние названия публикации состояния заменены на neutral runtime-state naming;
- версия синхронизирована: product `0.5.2-alpha.16`, manifest `0.5.2.16`, evidence schema `8`;
- OPK builder больше не зависит от 7-Zip: canonical packaging использует deterministic `zip -X`, фиксированные timestamps и CycloneDX SBOM;
- сохранена server-authoritative модель: Companion не начисляет XP самостоятельно.

## Перед QA

1. `npm run release:check`
2. `npm run build:opk`
3. `npm run verify:opk`
4. Clean install в Overwolf.
5. Проверить Standard / Ranked / Street Brawl, overlay, RU/EN, pairing/reconnect.
6. Провести два матча подряд, когда первый ещё ждёт provider verdict, и убедиться, что второй отображается как сохранённый.
