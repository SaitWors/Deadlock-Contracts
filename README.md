# Deadlock Contracts

Актуальные версии сайта и Companion указаны в `release.json`.

Порядок ближайших выпусков и критерии готовности: [план развития сайта](docs/design/ROADMAP_RU.md). Первый пункт — учебный шифр без входа и понятный следующий шаг в кабинете. Роль и студия дизайнера запланированы отдельным этапом и пока не реализованы.

Для разработки и проверки PR №31 начни с [инструкции Codespaces](docs/design/CODESPACE_RU.md). Она запускает отдельный тестовый экземпляр с текущим frontend и серверным подписанием. Дизайн и ограничения проверки описаны в [плане первого этапа](docs/design/STAGE1_RU.md).

## Основа alpha.9

**0.10.1-alpha.9:** первый pre-public QA candidate сайта и Companion с закрытой границей доверия, case-centric History и release-aligned metadata.

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
- свежий независимый provider полностью заменяет legacy GEP-факты; клиентский апдейт не может дополнить подтверждённый матч;
- History API и сайт пагинируют целыми делами, не разрезая 1–3 выбранных контракта между страницами;
- offline-очередь Companion сохраняет обе границы жизненного цикла — `match_started` и `match_ended`;
- рекламный слот fail-closed и отключён на всё время работы процесса Deadlock для первого QA.

## Документы

- [SEO: выкладка, Search Console, Bing и IndexNow](docs/SEO.md);
- [публичное описание проекта на русском и английском](docs/public-project.md);
- [арена бюро, EX, экономика и развёртывание миграции 0022](docs/development/bureau-arena.md);

- установка/обновление: `INSTALL_0.10.1_ALPHA9_RU.md`;
- изменения: `RELEASE_NOTES_0.10.1_ALPHA9_RU.md`;
- проверки: `TEST_REPORT_0.10.1_ALPHA9_RU.md`;
- trust/security: `SECURITY_AND_TRUST_RU.md`.

## Проверка

```bash
PYTHONPATH=. pytest -q
python scripts/release_check.py .
```

Frontend production build выполняется обычным Vite pipeline из `frontend/`.

Deadlock Contracts — неофициальный community-проект и не связан с Valve Corporation.
