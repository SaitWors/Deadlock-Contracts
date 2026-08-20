# Test report — Deadlock Contracts Web/Backend 0.10.1-alpha.7

Дата: 2026-08-19

- `PYTHONPATH=. pytest -q` — **79 passed**
- `python -m compileall -q app` — **PASS**
- `bash -n scripts/preflight.sh scripts/deploy-current.sh` — **PASS**
- `python scripts/release_check.py` — **PASS**

Добавлены regression tests для:

- exact Match ID + terminal session + Evidence v7 outcome info-update → contract-grade `summary.result`;
- outcome marker от другого/старого Match ID не может закрыть текущий win contract;
- canonical provider result имеет приоритет при конфликте с локальным GEP result;
- старый diagnostic-only outcome остаётся non-authoritative;
- partial settlement продолжает обрабатывать известные факты независимо от отсутствующего capability.
