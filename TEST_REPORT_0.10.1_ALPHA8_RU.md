# Deadlock Contracts 0.10.1-alpha.8 — test report

Дата: 22 августа 2026 года.

Перед commit release candidate выполняются:

- полный pytest suite;
- Python compileall;
- frontend oxfmt;
- TypeScript tsc --noEmit;
- production frontend build;
- production Compose validation;
- actionlint;
- release_check;
- release archive SHA-256 verification.

После push GitHub CI дополнительно выполняет
PostgreSQL migration smoke и release Docker build.

На серверном candidate до синхронизации с GitHub подтверждено:

- backend: **97/97 PASS**;

На exact GitHub candidate подтверждено локально:

- Companion: **44/44 PASS**;
- frontend TypeScript + production build: PASS;
- Companion release check + reproducible OPK SHA-256/integrity: PASS.

Для exact GitHub commit backend suite и Python dependency audit остаются
обязательными GitHub CI gates.

Остаётся обязательный ручной Windows/Overwolf/Deadlock QA exact OPK.
