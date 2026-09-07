# Deadlock Contracts Companion — QA-комплект

Точную версию, имя OPK и SHA-256 смотри в `CANDIDATE.json` в корне
распакованного комплекта. Этот файл генерируется из `companion/release.json`
и реально упакованных файлов. Название старого отчёта или ZIP не определяет
версию отправленного приложения.

## Проверка комплекта

1. В каталоге с внешним архивом выполнить `sha256sum -c *-BUNDLE.sha256`.
2. Распаковать архив. В его корне выполнить
   `sha256sum -c BUNDLE_CONTENT_SHA256SUMS.txt`.
3. Сверить `CANDIDATE.json`: версию продукта, `manifest_version`, имя OPK,
   его SHA-256 и целевую версию backend. Целевая версия не подтверждает,
   что именно она сейчас работает на сервере.
4. Установить файл из поля `opk.path` через доступные Overwolf Developer
   Options / testing channel. Исходный ZIP из `SOURCE/` предназначен для
   разработки и воспроизведения сборки.
5. Выполнить `QA_DOCS/OVERWOLF_QA_HANDOFF_RU.md` и заполнить матрицу
   `QA_DOCS/OVERWOLF_RELEASE_MATRIX_RU.md` для этого OPK.
6. Сохранить исходный OPK и его SHA-256 вместе с датой отправки, номером
   заявки, результатами ручной проверки и ответами Overwolf. При замене
   кандидата создать отдельную запись с новым хешем.

Сборщик проверяет идентичность release metadata и структуру OPK. Результаты
автотестов берутся из CI именно той ревизии, из которой получен комплект.
`not_recorded` означает отсутствие результата проверки или отправки;
сборщик не объявляет Windows QA, submission или approval завершёнными.

## Воспроизведение OPK из исходников

Распаковать `SOURCE/*-source.zip`, перейти во вложенный каталог `companion`
и выполнить на Linux / CI с Node.js 22, `zip` и `unzip`:

```bash
npm run release:check
node scripts/package-release.mjs
sha256sum dist/*.opk
```

Полученный SHA-256 должен совпасть с `CANDIDATE.json` → `opk.sha256`.
В исходники включены собственный `release.json`, схемы и fixtures; checkout
backend и родительский `release.json` для сборки Companion не требуются.
QA-комплект можно пересобрать командой `npm run build:qa-bundle`.

## Что проверяется вручную

Установка frozen OPK, Windows/Overwolf runtime, настоящий Deadlock GEP,
положение overlay и DPI, горячие клавиши, offline/reconnect, завершение
матча, фактическое поведение рекламы и финальное решение QA/DevRel.
Исторические скриншоты и отчёты других версий не подтверждают эти проверки.

Whitelist, проверка приложения и доступ к Developer Console фиксируются
отдельно. Официальный порядок:
https://dev.overwolf.com/ow-native/getting-started/release-your-app/
