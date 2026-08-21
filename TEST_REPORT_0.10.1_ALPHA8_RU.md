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

Known follow-up:
summary.healing / terminal summary.result evidence reliability.
