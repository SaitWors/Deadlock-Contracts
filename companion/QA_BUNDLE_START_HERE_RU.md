# Deadlock Contracts Companion — QA candidate 0.5.2-alpha.7

Это собранный QA комплект: внутри лежат правильный OPK, CycloneDX SBOM, checksums, QA-документы и отдельный source ZIP. Это **не** заявление, что Overwolf уже одобрил продукт.

## Быстрый порядок

1. Убедиться, что Web/Backend `0.10.1-alpha.9` доступен, health/ready зелёные и pairing работает.
2. Сверить SHA-256 OPK и `.cdx.json` с `OPK/SHA256SUMS.txt`.
3. Установить `OPK/Deadlock-Contracts-Companion-0.5.2-alpha.7.opk` через Overwolf Developer Options / testing channel.
4. Выполнить ручный чеклист из `QA_DOCS/OVERWOLF_QA_HANDOFF_RU.md` на Windows + актуальный Overwolf + Deadlock.
5. Не отправлять в review, пока не выполнены проверки hotkey, auto-hide, process-wide Deadlock ad shutdown, GEP, fullscreen/windowed/Alt+Tab и resolution/DPI matrix.

## Что проверяет автоматическая сборка

- unit/release/session/product tests;
- JavaScript syntax;
- manifest/version/icon/permission/CSP gates;
- запрет на server secrets и client-side settlement;
- correct OPK root structure и normal compression;
- static checks для transient overlay и desktop-only OwAd `400×60` slot;
- checksum итоговых архивов.

## Что automation не доказывает

- Windows/Overwolf runtime;
- реальный Deadlock GEP именно для frozen OPK;
- корректную позицию Overlay поверх каждого игрового HUD и DPI;
- фактическую подачу рекламного creative (её включает Overwolf после QA);
- окончательное решение DevRel/QA или VirusTotal/antivirus.
