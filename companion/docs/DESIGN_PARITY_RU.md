# Design parity

Цель: сайт и Overwolf Desktop выглядят как один продукт, а не как два зелёных интерфейса.

## Канон

- occult contract bureau;
- Deadlock noir;
- городской архив;
- старый металл / parchment / wax как редкий акцент;
- muted mint = active/selected/verified;
- cream = primary content;
- density без dashboard clutter;
- максимум 4–6px radius;
- почти нет декоративной анимации в рабочем UI.

## Что исправлено относительно alpha4

Старый alpha4 UI строился вокруг:

`Overview / Connection / Diagnostics / About`.

Новый desktop строится вокруг продуктового цикла:

`HQ / Contracts / Active Case / History / Profile / Settings`.

Diagnostics и pairing становятся Settings-функциями, а не главным продуктом.

## Реализованные общие элементы

Companion уже использует канонические:

- color tokens;
- typography tokens;
- Button;
- Badge;
- ContractCard;
- StatusChip;
- CaseFile;
- AppShell;
- i18n conventions;
- loading / empty / error / offline states;
- локальные Inter / Roboto Condensed / Cormorant Garamond.

Для сайта следующий безопасный шаг — перенести эти же tokens и component states в общий versioned package, не меняя визуальный канон и не превращая сайт в отдельную SaaS-тему.
