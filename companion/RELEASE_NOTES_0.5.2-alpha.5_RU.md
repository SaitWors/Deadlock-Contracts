# Deadlock Contracts Companion 0.5.2-alpha.5

## Что изменилось

- Сохранили всю серверную механику alpha.4: Companion показывает только server-issued boards, выбранные `option_ids`, provisional local progress и server verdict / XP. Клиент по-прежнему не может закрыть контракт или начислить награду.
- `Ctrl+Shift+C` теперь открывает аккуратную временную плашку, а не оставляет постоянный HUD: повторное нажатие скрывает её сразу, иначе она сама минимизируется через 6.5 секунды. Это снижает риск перекрыть игровой интерфейс.
- Overlay получил скруглённую «contract bureau» форму, более выразительный live progress, мягкий sweep бара, motion при смене activity-focus, подчёркивание выбранного контракта и короткий визуальный burst при **provisional** достижении цели.
- Добавлен один рекламный слот `400×60` только в Desktop HQ. Это `OwAd` Managed Ads Container из официального SDK Overwolf; он не создаётся в overlay, во время `GameInProgress`, в FTUE, на pairing/dialog/error pages или без сопряжённого аккаунта.
- В manifest добавлены `Streaming` и `Profile`, потому что их требует официальный OwAd SDK; остались необходимые `Extensions`, `GameInfo`, `Hotkeys`.

## Не обещаем того, чего код не может доказать

- Слот подготовлен корректно, но реальные объявления включаются Overwolf только после их рекламного QA.
- Этот архив является QA candidate, а не подтверждением, что Overwolf уже одобрил приложение.
- До submission нужны Windows + Overwolf + Deadlock проверки из `docs/OVERWOLF_QA_HANDOFF_RU.md`.
