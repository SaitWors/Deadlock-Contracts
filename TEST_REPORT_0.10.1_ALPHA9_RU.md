# Deadlock Contracts 0.10.1-alpha.9 — test report

Дата: 25 августа 2026 года.

На рабочем дереве кандидата подтверждено:

- backend pytest: **117/117 PASS**;
- trust-boundary и whole-case pagination regressions: **PASS**;
- Companion Node test runner: **57/57 PASS**;
- Companion release metadata: **PASS**;
- синтаксис всех `companion/src/*.js`: **PASS**;
- repository `release_check`: **PASS**;
- Python critical lint (`E9,F63,F7,F82`) и compile: **PASS**;
- Python dependency consistency: **PASS**.

На exact GitHub commit CI обязательно повторяет backend и Companion,
проверяет frontend `oxfmt`, `tsc --noEmit`, production Vite build и asset
budget, затем выполняет PostgreSQL migration smoke, dependency audits,
reproducible OPK/SBOM packaging и production Docker build.

Ветка намеренно не содержит готовый OPK: финальную упаковку и ручной install
делает владелец после зелёного CI. Это не меняет source readiness сайта и
Companion.

Остаётся обязательный ручной Windows/Overwolf/Deadlock QA exact OPK по
`companion/docs/OVERWOLF_QA_HANDOFF_RU.md`.
