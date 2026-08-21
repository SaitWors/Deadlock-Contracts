# Security model

## Главная граница доверия

Desktop App считается **недоверенным клиентом**.

Пользователь может изменить JS, localStorage, DOM и любой request. Это не должно позволять ему:

- создать контракт;
- изменить target/reward;
- выставить `COMPLETED`;
- начислить XP;
- стать ADMIN/OWNER;
- читать чужие объекты;
- получить доступ к PostgreSQL или server secrets.

## Что может делать клиент

- показать server-issued contract;
- отправить выбранные option IDs;
- показать provisional GEP;
- передать exact Match ID/evidence;
- запросить server verdict;
- кэшировать UI state;
- хранить device token только в OS-bound encrypted form.

## Что делает только backend

- ownership/authorization;
- snapshot контракта;
- attempts/locked_at;
- match binding;
- final provider lookup;
- evaluator;
- settlement;
- RewardLedger;
- roles/access;
- audit.

Пример атаки:

```js
contract.rewardXp = 999999
contract.status = 'COMPLETED'
```

Результат: пользователь может испортить только собственный UI. Backend всё равно использует сохранённый assignment и ledger.

## Secrets

В OPK запрещены:

- DB URL/password;
- Deadlock API key;
- Steam Web API key;
- session/master signing secrets;
- TOTP secret;
- Telegram bot token;
- любые credentials, позволяющие создавать trusted server facts.

`scripts/check-release.mjs` специально падает при типичных secret/backup paths и опасных permissions.

## Permissions

Companion использует:

- `Extensions` — app lifecycle/update state;
- `GameInfo` — Deadlock/GEP;
- `Hotkeys` — overlay hotkey.

Не используются `FileSystem`, `GameControl`, `Camera`, `Microphone`, `WebSocketServer`, `DesktopStreaming`.

## External content

Нет remote JavaScript, remote CSS или font requests. Inter, Roboto Condensed, Cormorant Garamond и Barlow Condensed включены локально с OFL license files. Runtime CSP запрещает `unsafe-inline` styles и `unsafe-eval`; сеть разрешена только к официальному `https://deadlock-contracts.online`.
