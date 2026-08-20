# Deadlock Contracts Web/Backend v0.10.1-alpha.7

**0.10.1-alpha.7:** trusted outcome-info correlation for win contracts, faster bounded post-match verification, startup repair generation and Open-Beta-aware deploy gates.

Backend remains authoritative: Companion/GEP evidence is accepted only through strict exact-match/session correlation; provider facts win on conflict.


## Главное в версии

- восстановлен атмосферный motion layer главной страницы из проверенной 0.9.16 design-линии без возврата старых mock semantics;
- добавлены reduced-motion и mobile guards для декоративных эффектов;
- исправлен случай, когда одно отсутствующее final-поле держало всё дело в `VERIFYING`;
- exact-match + trusted `match_end` теперь позволяют использовать GEP `match_clock` как duration fallback;
- startup repair повторно подхватывает уже зависшие дела;
- добавлен `Adaptive Contracts` foundation (`contracts-3.0.0-alpha.1`);
- personalization строится из последних server-stored final matches отдельно по режимам;
- cold start безопасно остаётся на обычной генерации;
- Desktop получает объяснимый `generator_meta.adaptive`, но не получает authority над target/status/XP.
- Admin Operations показывает Adaptive Profile, verification health и безопасный server-side recheck зависшего `VERIFYING`.
- возвращена полная public-навигация Landing;
- добавлен настоящий Verified Leaderboard без mock-игроков, Steam/MMR подмены и влияния admin XP adjustments;
- leaderboard уважает public-profile privacy: участвуют только профили с `is_public=true` и `show_stats=true`.
- Desktop bootstrap отдаёт capability flags `adaptive_profiles_v1` и `debrief_v1`;
- post-match read model сохраняет `last_attempt_match_id` и `latest_evaluation`, даже если retryable miss уже освободил `bound_match_id`;
- `reward_granted_xp` берётся только из trusted contract reward-ledger sources; `ADMIN_ADJUSTMENT` не может быть выдан за XP конкретного контракта.

## Документы

- установка/обновление: `INSTALL_0.10.1_ALPHA7_RU.md`;
- изменения: `RELEASE_NOTES_0.10.1_ALPHA7_RU.md`;
- проверки: `TEST_REPORT_0.10.1_ALPHA7_RU.md`;
- trust/security: `SECURITY_AND_TRUST_RU.md`.

## Проверка

```bash
PYTHONPATH=. pytest -q
python scripts/release_check.py .
```

Frontend production build выполняется обычным Vite pipeline из `frontend/`.

Deadlock Contracts — неофициальный community-проект и не связан с Valve Corporation.