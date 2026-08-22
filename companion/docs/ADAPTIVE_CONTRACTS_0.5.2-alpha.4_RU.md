# Companion 0.5.2-alpha.4 — Adaptive Contracts + trusted result evidence

Adaptive Contracts, server debrief и Live Focus Overlay сохранены из предыдущего QA build.

Новое в alpha.3 — Evidence schema v7. Companion различает:

- `match_outcome`, который просто вернулся в `getInfo` — diagnostic only;
- реальный `match_outcome` info-update — помечается временем наблюдения и текущим exact Match ID.

Backend решает, достаточно ли этой корреляции для `summary.result`; Companion сам не выставляет `COMPLETED`, не начисляет XP и не определяет окончательный verdict.
