# Alpha.5 — реклама и overlay: решение для QA

## Реклама

- Используется только официальный `OwAd` SDK: `https://content.overwolf.com/libs/ads/latest/owads.min.js`.
- Один managed display container `400×60`, `containerId=dc_400x60_desktop_b` (19 символов), parent с `background: transparent`.
- Нет внешних iframe, нет ручной подмены creative, opacity не меняется, нет video/interstitial/high-impact форматов.
- Container существует только рядом с реальным содержимым Desktop HQ. Он выключается в FTUE, settings/pairing/dialog/error views и при активной фазе `GameInProgress`; на overlay его нет.
- При уходе из допустимого состояния контейнер вызывает `OwAd.shutdown()` и очищается; при возвращении создаётся заново, а не переносится по страницам.
- Реальные объявления не гарантированы локальной сборкой: Overwolf включает serving после финального ad QA.

## Overlay

- Overlay не содержит рекламы.
- Его нельзя открыть автоматически: только действие пользователя через hotkey/кнопку Desktop.
- Он не сохраняется на экране: максимум 6.5 секунды и всегда легко скрывается повторным hotkey.
- Перед отправкой нужен реальный визуальный тест размещения именно в Deadlock. Если плашка хоть где-то закрывает критичный HUD, позицию/размер надо изменить до submission.
