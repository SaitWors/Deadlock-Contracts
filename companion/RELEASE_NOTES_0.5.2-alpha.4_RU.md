# Deadlock Contracts Companion 0.5.2-alpha.4

## Summary evidence reliability

Исправлена потеря provenance у nested Overwolf `onInfoUpdates2`.
Настоящий `match_outcome` info update теперь может сформировать
Evidence-v7 exact-match marker.

Cached `getInfo(match_outcome)` намеренно остаётся
diagnostic-only и не получает settlement authority.

Для Standard/Ranked trusted final GEP healing получает
`summary.healing`.

Street Brawl продолжает использовать отдельную capability
`gep.scoreboard_healing`.

Terminal lifecycle теперь требует gameplay proof: положительный
match clock. Одна фаза `PostGame` и одна только длительность открытого
окна не могут закрыть матч до реального начала игры.

## Compatibility

Manifest version: `0.5.2.4`.

Minimum GEP: `311.0.0`.

Причина GEP floor: Deadlock `winning_team` был добавлен
в `match_outcome` начиная с GEP 311.0.0.

## Status

Это QA candidate. До отправки Overwolf требуется live
Deadlock match validation и проверка frozen OPK.
