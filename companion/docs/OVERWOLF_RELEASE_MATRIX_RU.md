# Overwolf — матрица проверки кандидата

Шаблон для нового OPK. Версия и SHA-256 берутся из `CANDIDATE.json`,
созданного вместе с QA-комплектом. В исходниках источник версий —
`companion/release.json`. Старые результаты не переносятся автоматически.

Перед проверкой записать: OPK и SHA-256, ревизию исходников, версию backend,
флаги сервера, дату, проверяющего, Windows, Overwolf, GEP и Deadlock.
Для каждого PASS приложить наблюдение, лог или снимок экрана.

| Проверка | Что подтвердить | Начальный статус |
|---|---|---|
| Release metadata и OPK | Поля версии, структура архива, контрольные суммы | Результат сборки в CANDIDATE.json |
| Автотесты и воспроизведение исходников | CI нужной ревизии; повторный OPK с тем же SHA-256 | NOT RECORDED |
| Установка и Desktop | Устанавливается frozen OPK, видимое окно, FTUE | NOT RUN |
| Pairing | Вход, истёкший/неверный код, revoke, восстановление | NOT RUN |
| Контракты | Выбор 1–3 условий, серверная подпись, сохранение дела | NOT RUN |
| Overlay и горячая клавиша | Фокус, HUD, rebind, unassigned, auto-hide | NOT RUN |
| Реальный GEP | Поддержанные режимы, точный Match ID, отсутствие выдуманных значений | NOT RUN |
| Конец матча и очередь | Exit/restart/grace, offline/reconnect, две игры подряд | NOT RUN |
| Серверный результат | Верный матч и фактически начисленный XP без повторов | NOT RUN |
| Реклама | Флаг, отсутствие в gameplay/overlay/FTUE, отдельный serving test | NOT RUN |
| Разрешения и DPI | 1366×720, 1366×768, 1080p@125%, 4K@150% | NOT RUN |
| Окна и нагрузка | Fullscreen/borderless/windowed, Alt+Tab, CPU/RAM/network | NOT RUN |
| RU/EN и доступность | Длинные строки, контраст, reduced motion, ошибки сети | NOT RUN |
| Manifest и антивирус | Актуальные требования Overwolf и проверка frozen OPK | NOT RUN |
| Whitelist | Письмо/подтверждение для нужного аккаунта | NOT RECORDED |
| Отправка приложения | Дата, канал/номер заявки, отправленный OPK и SHA-256 | NOT RECORDED |
| QA и Developer Console | Ответ DevRel/QA и фактический доступ | NOT RECORDED |

Эта таблица — шаблон комплекта, а не статус аккаунта команды. Наличие
whitelist не заполняет строку прохождения QA. По официальной документации
доступ к Developer Console предоставляют после одобрения приложения QA:
https://dev.overwolf.com/ow-native/developers-console/the-developers-console/
