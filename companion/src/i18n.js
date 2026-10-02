(function attachI18n(root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCI18n = api
})(typeof window !== 'undefined' ? window : globalThis, root => {
  const PREF_KEY = 'dc.language.v2'
  const SERVER_LANGUAGE_KEY = 'dc.serverLanguage.v1'
  const MISSING = new Set()

  const CATALOG = {
    en: {
      'app.name': 'DEADLOCK CONTRACTS',
      'app.qa_candidate': 'QA CANDIDATE',
      'common.cancel': 'CANCEL',
      'common.confirm': 'CONFIRM',
      'common.never': 'Never',
      'common.seconds': '{target} sec',
      'common.minutes': '{target} min',
      'contract.untitled': 'UNTITLED CONTRACT',
      'mode.STANDARD': 'Standard',
      'mode.RANKED': 'Ranked',
      'mode.STREET_BRAWL': 'Street Brawl',
      'mode.unknown': 'Mode is not determined yet',
      'objective.prefix': 'In your next {mode} match: {conditions}.',
      'join.and.two': '{a} and {b}',
      'condition.player.kills.gte': 'Get at least {target} kills',
      'condition.player.kills.lte': 'Get no more than {target} kills',
      'condition.player.kills.eq': 'Get exactly {target} kills',
      'condition.player.deaths.gte': 'Die at least {target} times',
      'condition.player.deaths.lte': 'Die no more than {target} times',
      'condition.player.deaths.eq': 'Die exactly {target} times',
      'condition.player.assists.gte': 'Get at least {target} assists',
      'condition.player.assists.lte': 'Get no more than {target} assists',
      'condition.player.assists.eq': 'Get exactly {target} assists',
      'condition.player.kda.gte': 'Finish with at least {target} KDA',
      'condition.player.kda.lte': 'Finish with no more than {target} KDA',
      'condition.player.kda.eq': 'Finish with exactly {target} KDA',
      'condition.player.net_worth.final.gte': 'Finish with at least {target} souls',
      'condition.player.net_worth.final.lte': 'Finish with no more than {target} souls',
      'condition.player.net_worth.final.eq': 'Finish with exactly {target} souls',
      'condition.player.hero_damage.gte': 'Deal at least {target} hero damage',
      'condition.player.hero_damage.lte': 'Deal no more than {target} hero damage',
      'condition.player.hero_damage.eq': 'Deal exactly {target} hero damage',
      'condition.player.object_damage.gte': 'Deal at least {target} objective damage',
      'condition.player.object_damage.lte': 'Deal no more than {target} objective damage',
      'condition.player.object_damage.eq': 'Deal exactly {target} objective damage',
      'condition.player.healing.gte': 'Provide at least {target} healing',
      'condition.player.healing.lte': 'Provide no more than {target} healing',
      'condition.player.healing.eq': 'Provide exactly {target} healing',
      'condition.player.scoreboard_healing.gte': 'Record at least {target} scoreboard healing',
      'condition.player.scoreboard_healing.lte': 'Record no more than {target} scoreboard healing',
      'condition.player.scoreboard_healing.eq': 'Record exactly {target} scoreboard healing',
      'condition.match.duration_s.gte': 'Play a match lasting at least {target}',
      'condition.match.duration_s.lte': 'Play a match lasting no more than {target}',
      'condition.match.duration_s.eq': 'Play a match lasting exactly {target}',
      'condition.match.win.eq': 'Win the match',
      'metric.player.kills': 'KILLS',
      'metric.player.deaths': 'DEATHS',
      'metric.player.assists': 'ASSISTS',
      'metric.player.kda': 'KDA',
      'metric.player.net_worth.final': 'FINAL SOULS',
      'metric.player.hero_damage': 'HERO DAMAGE',
      'metric.player.object_damage': 'OBJECT DAMAGE',
      'metric.player.healing': 'HEALING',
      'metric.player.scoreboard_healing': 'SCOREBOARD HEALING',
      'metric.match.duration_s': 'MATCH DURATION',
      'metric.match.win': 'MATCH WIN',
      'progress.IN_PROGRESS': 'IN PROGRESS',
      'progress.TARGET_REACHED_PROVISIONAL': 'TARGET REACHED · PROVISIONAL',
      'progress.WITHIN_LIMIT': 'WITHIN LIMIT · PROVISIONAL',
      'progress.ON_TARGET_PROVISIONAL': 'ON TARGET · PROVISIONAL',
      'progress.OVERSHOT': 'OVERSHOT · MISSED',
      'progress.PENDING_MATCH_RESULT': 'PENDING MATCH RESULT',
      'progress.UNKNOWN': 'WAITING FOR DATA',
      'progress.budget_used': '{current} / {target} USED',
      'progress.exact': '{current} / EXACTLY {target}',
      'status.PARTIALLY_SETTLED': 'PARTIAL RESULT',
      'status.PARTIAL': 'PARTIAL RESULT',
      'status.UNKNOWN': 'UNKNOWN SERVER STATUS',
      'health.game': 'GAME PROCESS',
      'health.gep': 'LIVE DATA (GEP)',
      'health.auth': 'ACCOUNT / IDENTITY',
      'health.backend': 'SERVER / NETWORK',
      'health.storage': 'LOCAL STORAGE / QUEUE',
      'health.stale': 'LIVE DATA STALE · {seconds} SEC',
      'health.open_desktop': 'OPEN DESKTOP FOR RECOVERY',
      'hotkey.unassigned': 'Overlay hotkey is not assigned',
      'hotkey.open_settings': 'OPEN OVERWOLF HOTKEY SETTINGS',
      'pair.invalid_format': 'Pairing code must contain 8–12 letters/numbers. Example: ABCD-EFGH.',
      'pair.expired': 'Pairing code expired. Create a new code and try again.',
      'pair.storage_invalid': 'Saved login could not be read. Pair this device again.',
      'sync.ok': 'Data updated',
      'sync.offline': 'Offline. Local evidence is retained and will sync after reconnection.',
      'sync.failed': 'Sync failed',
      'ad.unavailable': 'AD UNAVAILABLE',
      'ad.served': 'AD SERVED BY OVERWOLF',
      'ad.sponsored': 'SPONSORED CONTENT',
      'ad.requesting': 'REQUESTING OVERWOLF AD',
      'ad.loading_sdk': 'LOADING OVERWOLF AD SDK',
      'ad.sdk_init_failed': 'AD SDK DID NOT INITIALIZE',
      'ad.sdk_unavailable': 'AD SDK UNAVAILABLE',
      'privacy.summary': 'For contract verification, Companion processes your SteamID, selected contracts, Deadlock game events, synchronization history, and technical diagnostics. Ads and their technical events run only in the desktop window. See Privacy for details.',
      'exit.title': 'EXIT COMPANION?',
      'exit.keep': 'KEEP RUNNING',
      'exit.anyway': 'EXIT ANYWAY',
      'exit.active_match': 'Active match',
      'exit.pending': 'Pending uploads',
      'exit.rejected': 'Rejected uploads',
      'exit.last_ack': 'Last server acknowledgement',
      'update.CHECKING': 'CHECKING',
      'update.UP_TO_DATE': 'UP TO DATE',
      'update.UPDATE_AVAILABLE': 'UPDATE AVAILABLE',
      'update.PENDING_RESTART': 'PENDING RESTART',
      'update.FAILED': 'UPDATE CHECK FAILED',
      'error.SERVER_CONTRACT_CHANGED': 'Server contract changed. Refresh before locking.',
      'error.API_VERSION_MISMATCH': 'Server API version is incompatible.',
      'error.SCHEMA_VERSION_UNSUPPORTED': 'Server schema is not supported by this Companion.',
      'error.LOCAL_STORAGE_FULL': 'Local storage is full. Export or clear local data before continuing.',
      'error.FINAL_NOT_SENT_MISSING_PROOF': 'Final result was not sent because terminal proof is incomplete.',
      'error.AUTH_STORAGE_INVALID': 'Saved login could not be read. Pair this device again.',
    },
    ru: {
      'app.name': 'DEADLOCK CONTRACTS',
      'app.qa_candidate': 'QA-КАНДИДАТ',
      'common.cancel': 'ОТМЕНА',
      'common.confirm': 'ПОДТВЕРДИТЬ',
      'common.never': 'Никогда',
      'common.seconds': '{target} сек',
      'common.minutes': '{target} мин',
      'contract.untitled': 'КОНТРАКТ БЕЗ НАЗВАНИЯ',
      'mode.STANDARD': 'обычном',
      'mode.RANKED': 'рейтинговом',
      'mode.STREET_BRAWL': 'уличном',
      'mode.unknown': 'Режим пока не определён',
      'objective.prefix': 'В следующем {mode} матче: {conditions}.',
      'join.and.two': '{a} и {b}',
      'condition.player.kills.gte': 'Совершите не менее {target} убийств',
      'condition.player.kills.lte': 'Совершите не более {target} убийств',
      'condition.player.kills.eq': 'Совершите ровно {target} убийств',
      'condition.player.deaths.gte': 'Допустите не менее {target} смертей',
      'condition.player.deaths.lte': 'Допустите не более {target} смертей',
      'condition.player.deaths.eq': 'Допустите ровно {target} смертей',
      'condition.player.assists.gte': 'Сделайте не менее {target} помощей',
      'condition.player.assists.lte': 'Сделайте не более {target} помощей',
      'condition.player.assists.eq': 'Сделайте ровно {target} помощей',
      'condition.player.kda.gte': 'Завершите матч с KDA не ниже {target}',
      'condition.player.kda.lte': 'Завершите матч с KDA не выше {target}',
      'condition.player.kda.eq': 'Завершите матч с KDA ровно {target}',
      'condition.player.net_worth.final.gte': 'Завершите матч минимум с {target} душ',
      'condition.player.net_worth.final.lte': 'Завершите матч максимум с {target} душ',
      'condition.player.net_worth.final.eq': 'Завершите матч ровно с {target} душ',
      'condition.player.hero_damage.gte': 'Нанесите не менее {target} урона героям',
      'condition.player.hero_damage.lte': 'Нанесите не более {target} урона героям',
      'condition.player.hero_damage.eq': 'Нанесите ровно {target} урона героям',
      'condition.player.object_damage.gte': 'Нанесите не менее {target} урона объектам',
      'condition.player.object_damage.lte': 'Нанесите не более {target} урона объектам',
      'condition.player.object_damage.eq': 'Нанесите ровно {target} урона объектам',
      'condition.player.healing.gte': 'Восстановите не менее {target} здоровья',
      'condition.player.healing.lte': 'Восстановите не более {target} здоровья',
      'condition.player.healing.eq': 'Восстановите ровно {target} здоровья',
      'condition.player.scoreboard_healing.gte': 'Наберите не менее {target} лечения по таблице',
      'condition.player.scoreboard_healing.lte': 'Наберите не более {target} лечения по таблице',
      'condition.player.scoreboard_healing.eq': 'Наберите ровно {target} лечения по таблице',
      'condition.match.duration_s.gte': 'Матч должен длиться не менее {target}',
      'condition.match.duration_s.lte': 'Матч должен длиться не более {target}',
      'condition.match.duration_s.eq': 'Матч должен длиться ровно {target}',
      'condition.match.win.eq': 'Победите в матче',
      'metric.player.kills': 'УБИЙСТВА',
      'metric.player.deaths': 'СМЕРТИ',
      'metric.player.assists': 'ПОМОЩИ',
      'metric.player.kda': 'KDA',
      'metric.player.net_worth.final': 'ДУШИ В ФИНАЛЕ',
      'metric.player.hero_damage': 'УРОН ГЕРОЯМ',
      'metric.player.object_damage': 'УРОН ОБЪЕКТАМ',
      'metric.player.healing': 'ЛЕЧЕНИЕ',
      'metric.player.scoreboard_healing': 'ЛЕЧЕНИЕ ПО ТАБЛИЦЕ',
      'metric.match.duration_s': 'ДЛИТЕЛЬНОСТЬ',
      'metric.match.win': 'ПОБЕДА',
      'progress.IN_PROGRESS': 'В ПРОЦЕССЕ',
      'progress.TARGET_REACHED_PROVISIONAL': 'ЦЕЛЬ ДОСТИГНУТА · ПРЕДВАРИТЕЛЬНО',
      'progress.WITHIN_LIMIT': 'В ПРЕДЕЛАХ ЛИМИТА · ПРЕДВАРИТЕЛЬНО',
      'progress.ON_TARGET_PROVISIONAL': 'РОВНО НА ЦЕЛИ · ПРЕДВАРИТЕЛЬНО',
      'progress.OVERSHOT': 'ПРЕВЫШЕНО · ПРОМАХ',
      'progress.PENDING_MATCH_RESULT': 'ОЖИДАЕМ ИТОГ МАТЧА',
      'progress.UNKNOWN': 'ОЖИДАЕМ ДАННЫЕ',
      'progress.budget_used': '{current} / {target} ИСПОЛЬЗОВАНО',
      'progress.exact': '{current} / РОВНО {target}',
      'status.PARTIALLY_SETTLED': 'ЧАСТИЧНЫЙ ИТОГ',
      'status.PARTIAL': 'ЧАСТИЧНЫЙ ИТОГ',
      'status.UNKNOWN': 'НЕИЗВЕСТНЫЙ СТАТУС СЕРВЕРА',
      'health.game': 'ПРОЦЕСС ИГРЫ',
      'health.gep': 'ЖИВЫЕ ДАННЫЕ (GEP)',
      'health.auth': 'АККАУНТ / ИДЕНТИЧНОСТЬ',
      'health.backend': 'СЕРВЕР / СЕТЬ',
      'health.storage': 'ЛОКАЛЬНОЕ ХРАНИЛИЩЕ / ОЧЕРЕДЬ',
      'health.stale': 'ЖИВЫЕ ДАННЫЕ УСТАРЕЛИ · {seconds} СЕК',
      'health.open_desktop': 'ОТКРОЙТЕ COMPANION ДЛЯ ВОССТАНОВЛЕНИЯ',
      'hotkey.unassigned': 'Горячая клавиша оверлея не назначена',
      'hotkey.open_settings': 'ОТКРЫТЬ НАСТРОЙКИ ГОРЯЧИХ КЛАВИШ OVERWOLF',
      'pair.invalid_format': 'Код привязки должен содержать 8–12 букв/цифр. Пример: ABCD-EFGH.',
      'pair.expired': 'Код привязки истёк. Создайте новый и повторите.',
      'pair.storage_invalid': 'Сохранённый вход не удалось прочитать. Повторно привяжите устройство.',
      'sync.ok': 'Данные обновлены',
      'sync.offline': 'Нет сети. Локальные данные сохранены и отправятся после подключения.',
      'sync.failed': 'Синхронизация не удалась',
      'ad.unavailable': 'РЕКЛАМА НЕДОСТУПНА',
      'ad.served': 'РЕКЛАМА ПОЛУЧЕНА ЧЕРЕЗ OVERWOLF',
      'ad.sponsored': 'СПОНСОРСКИЙ КОНТЕНТ',
      'ad.requesting': 'ЗАПРАШИВАЕМ РЕКЛАМУ OVERWOLF',
      'ad.loading_sdk': 'ЗАГРУЖАЕМ OVERWOLF ADS SDK',
      'ad.sdk_init_failed': 'ADS SDK НЕ ИНИЦИАЛИЗИРОВАЛСЯ',
      'ad.sdk_unavailable': 'ADS SDK НЕДОСТУПЕН',
      'privacy.summary': 'Для проверки контрактов Companion обрабатывает ваш SteamID, выбранные контракты, игровые события Deadlock, историю синхронизации и техническую диагностику. Реклама и её технические события работают только в desktop-окне. Подробнее — в Privacy.',
      'exit.title': 'ВЫЙТИ ИЗ COMPANION?',
      'exit.keep': 'ОСТАВИТЬ РАБОТАТЬ',
      'exit.anyway': 'ВСЁ РАВНО ВЫЙТИ',
      'exit.active_match': 'Активный матч',
      'exit.pending': 'Ожидают отправки',
      'exit.rejected': 'Отклонено',
      'exit.last_ack': 'Последнее подтверждение сервера',
      'update.CHECKING': 'ПРОВЕРЯЕМ',
      'update.UP_TO_DATE': 'АКТУАЛЬНАЯ ВЕРСИЯ',
      'update.UPDATE_AVAILABLE': 'ДОСТУПНО ОБНОВЛЕНИЕ',
      'update.PENDING_RESTART': 'НУЖЕН ПЕРЕЗАПУСК',
      'update.FAILED': 'ОШИБКА ПРОВЕРКИ ОБНОВЛЕНИЯ',
      'error.SERVER_CONTRACT_CHANGED': 'Контракт на сервере изменился. Обновите данные перед фиксацией.',
      'error.API_VERSION_MISMATCH': 'Версия API сервера несовместима.',
      'error.SCHEMA_VERSION_UNSUPPORTED': 'Схема сервера не поддерживается этой версией Companion.',
      'error.LOCAL_STORAGE_FULL': 'Локальное хранилище заполнено. Экспортируйте или очистите данные.',
      'error.FINAL_NOT_SENT_MISSING_PROOF': 'Финальный результат не отправлен: недостаточно доказательств завершения матча.',
      'error.AUTH_STORAGE_INVALID': 'Сохранённый вход не удалось прочитать. Повторно привяжите устройство.',
    },
  }


  // Existing desktop labels are folded into the single Alpha.9 catalog.
  Object.assign(CATALOG.en, {"hq":"HQ","contracts":"CONTRACTS","activeCase":"ACTIVE CASE","debrief":"DEBRIEF","history":"HISTORY","profile":"PROFILE","settings":"SETTINGS","createdBy":"CREATED BY","mcg":"MANDARIN CREATOR GROUP","bureauSignal":"BUREAU SIGNAL / ONLINE OPERATIONS","operationsHq":"OPERATIONS HQ","heroTitle":"CHOOSE THE CASE. PLAY THE MATCH. CLOSE THE FILE.","heroBody":"Deadlock Contracts turns ordinary matches into verified objectives. The Companion is your control room; the server keeps every verdict honest.","openContracts":"OPEN CONTRACTS","openActive":"ACTIVE CASE","contractsBody":"Choose one to three server-issued contracts. Locking is final for this daily board.","verifiedLater":"Live values are provisional. The server issues the final verdict after the match.","kills":"KILLS","deaths":"DEATHS","assists":"ASSISTS","healing":"HEALING","heroDamage":"HERO DAMAGE","objectDamage":"OBJECT DAMAGE","souls":"SOULS","matchClock":"MATCH CLOCK","serverVerdict":"SERVER VERDICT ONLY","authorityCopy":"The Companion records evidence but cannot complete a contract or grant XP.","historyBody":"Every locked assignment and its authoritative settlement record.","profileBody":"Identity, progression and performance by operation.","account":"ACCOUNT","settingsSecurity":"No database credentials, master keys or settlement authority live in this package.","pairTitle":"CONNECT DEADLOCK CONTRACTS","pairBody":"Create a short-lived code on the official site, then enter it here. The code is exchanged once; the resulting token is encrypted for the current Windows user.","connect":"CONNECT","openWebsite":"OPEN WEBSITE","pairHelp":"Open the official site, go to PROFILE → Companion, generate a short-lived code, then enter it here.","disconnect":"DISCONNECT","syncNow":"SYNC NOW","language":"LANGUAGE","languageBody":"Use the system language or keep a manual choice.","overlay":"OVERLAY","overlayBody":"A minimal input-pass-through case widget that auto-hides after a few seconds. You can resize or reset it here.","showOverlay":"SHOW / HIDE","resetPosition":"RESET POSITION","hotkeySettings":"HOTKEY","diagnostics":"DIAGNOSTICS","copyReport":"COPY REPORT","updateBody":"Release updates are delivered by Overwolf.","checkUpdate":"CHECK UPDATE","exitApp":"EXIT APP","ftueEyebrow":"WELCOME TO THE CONTRACT BUREAU","ftueTitle":"YOUR NEXT MATCH HAS A FILE NUMBER","ftueBody":"Pick one to three contracts, play the matching Deadlock mode, and wait for the server verdict. Live numbers are guidance, never a self-issued reward.","ftueOne":"Pair your website account","ftueTwo":"Lock a daily case before the match","ftueThreePrefix":"Toggle the overlay with","continue":"ENTER HQ","pairNow":"PAIR ACCOUNT","ftuePrivacy":"For contract verification, Companion processes your SteamID, selected contracts, Deadlock telemetry, synchronization state and technical diagnostics. See Privacy for details.","running":"RUNNING","notRunning":"NOT RUNNING","waiting":"WAITING","online":"ONLINE","offline":"OFFLINE","unpaired":"UNPAIRED","connected":"CONNECTED","degraded":"DEGRADED","incompatible":"SERVER UPDATE NEEDED","verified":"VERIFIED","mismatch":"MISMATCH","pairFirst":"PAIR ACCOUNT","pairFirstBody":"Connect your official Deadlock Contracts account to load daily boards.","loading":"LOADING DOSSIER","retry":"RETRY","noBoard":"BOARD UNAVAILABLE","noActiveCase":"NO ACTIVE CASE","noActiveBody":"Choose and lock one to three contracts before the match begins.","openBoard":"OPEN BOARD","selected":"SELECTED","select":"SELECT","locked":"LOCKED","verifying":"VERIFYING","reviewRequired":"REVIEW REQUIRED","completed":"COMPLETED","failed":"FAILED","partial":"PARTIAL RESULT","offered":"OFFERED","lockCase":"LOCK CASE","reroll":"REROLL","reset":"RESET","serverAuthority":"SERVER AUTHORITY","provisional":"LIVE / PROVISIONAL","postMatch":"POST-MATCH","attempt":"ATTEMPT","attempts":"ATTEMPTS","reward":"REWARD","records":"RECORDS","syncComplete":"Server data refreshed.","reportCopied":"Diagnostic report copied.","pairSuccess":"Account connected.","disconnected":"Companion disconnected.","enterCode":"Enter the pairing code first.","actionFailed":"Action failed","lockTitle":"LOCK THIS CASE?","lockWarning":"You cannot change these contracts until this board settles or expires.","rerollTitle":"REROLL THIS BOARD?","rerollWarning":"Your one shared daily reroll will be consumed.","cancel":"CANCEL","confirmLock":"LOCK CONTRACTS","confirmReroll":"REROLL BOARD","noHistory":"NO CASE FILES YET","noHistoryBody":"Locked contracts and their verdicts will appear here.","localEvidence":"LOCAL EVIDENCE","serverLedger":"SERVER LEDGER","staleCache":"CACHED DATA","updated":"UPDATED","personalized":"PERSONALIZED","whyContract":"WHY THIS CONTRACT?","recentMatches":"recent verified matches","adaptiveCold":"STANDARD BOARD","adaptiveConsistency":"CONSISTENCY","adaptiveChallenge":"CHALLENGE","adaptiveMastery":"MASTERY","adaptiveHabit":"BREAK THE HABIT","adaptiveWildcard":"WILDCARD","personalIntel":"PERSONAL INTEL","adaptiveBody":"Server-built baseline from your verified recent matches. It changes only after final scored matches.","calibration":"CALIBRATING","confidence":"CONFIDENCE","sample":"SAMPLE","median":"MEDIAN","strongMatch":"P75 / STRONG MATCH","best":"BEST","debriefBody":"The latest server-evaluated match, XP ledger result and current adaptive baseline.","noDebrief":"NO VERIFIED MATCH YET","noDebriefBody":"After a locked case is evaluated, the authoritative result will appear here.","xpGranted":"XP GRANTED","xpPending":"XP LEDGER PENDING","attemptMissed":"ATTEMPT MISSED","stillActive":"CONTRACT REMAINS ACTIVE","newVerdict":"NEW VERDICT","localCapture":"LOCAL CAPTURE / PROVISIONAL","latestServerResult":"LATEST SERVER RESULT","debriefNeedsServer":"Server 0.10.1-alpha.6 or newer is required for authoritative XP-ledger debriefs.","adaptiveNeedsServer":"Update the server to load verified adaptive profiles."})
  Object.assign(CATALOG.ru, {"hq":"HQ","contracts":"КОНТРАКТЫ","activeCase":"АКТИВНОЕ ДЕЛО","debrief":"ИТОГ МАТЧА","history":"ИСТОРИЯ","profile":"ПРОФИЛЬ","settings":"НАСТРОЙКИ","createdBy":"СОЗДАНО","mcg":"MANDARIN CREATOR GROUP","bureauSignal":"СИГНАЛ БЮРО / ОПЕРАЦИИ ОНЛАЙН","operationsHq":"ОПЕРАТИВНЫЙ ШТАБ","heroTitle":"ВЫБЕРИ ДЕЛО. СЫГРАЙ МАТЧ. ЗАКРОЙ ПАПКУ.","heroBody":"Deadlock Contracts превращает обычные матчи в проверяемые задания. Companion — ваш штаб, сервер — источник честного решения.","openContracts":"ОТКРЫТЬ КОНТРАКТЫ","openActive":"АКТИВНОЕ ДЕЛО","contractsBody":"Выберите от одного до трёх серверных контрактов. Фиксация этой доски окончательна.","verifiedLater":"Live-значения предварительные. Финальный вердикт после матча выносит сервер.","kills":"УБИЙСТВА","deaths":"СМЕРТИ","assists":"ПОМОЩЬ","healing":"ЛЕЧЕНИЕ","heroDamage":"УРОН ГЕРОЯМ","objectDamage":"УРОН ОБЪЕКТАМ","souls":"ДУШИ","matchClock":"ВРЕМЯ МАТЧА","serverVerdict":"ТОЛЬКО СЕРВЕРНЫЙ ВЕРДИКТ","authorityCopy":"Companion записывает доказательства, но не может закрыть контракт или начислить XP.","historyBody":"Все зафиксированные задания и их серверные решения.","profileBody":"Личность, прогресс и результаты по режимам.","account":"АККАУНТ","settingsSecurity":"В пакете нет ключей базы, master keys или права выносить решения.","pairTitle":"ПОДКЛЮЧИТЬ DEADLOCK CONTRACTS","pairBody":"Создайте короткоживущий код на официальном сайте и введите его здесь. Код обменивается один раз, а токен шифруется для текущего пользователя Windows.","connect":"ПОДКЛЮЧИТЬ","openWebsite":"ОТКРЫТЬ САЙТ","pairHelp":"Откройте официальный сайт, перейдите PROFILE → Companion, создайте короткоживущий код и введите его здесь.","disconnect":"ОТКЛЮЧИТЬ","syncNow":"СИНХРОНИЗИРОВАТЬ","language":"ЯЗЫК","languageBody":"Используйте язык системы или сохраните ручной выбор.","overlay":"ОВЕРЛЕЙ","overlayBody":"Минимальный input-pass-through виджет дела, который сам скрывается через несколько секунд. Здесь можно изменить размер или сбросить позицию.","showOverlay":"ПОКАЗАТЬ / СКРЫТЬ","resetPosition":"СБРОСИТЬ ПОЗИЦИЮ","hotkeySettings":"HOTKEY","diagnostics":"ДИАГНОСТИКА","copyReport":"КОПИРОВАТЬ ОТЧЁТ","updateBody":"Обновления приложения доставляет Overwolf.","checkUpdate":"ПРОВЕРИТЬ","exitApp":"ВЫЙТИ","ftueEyebrow":"ДОБРО ПОЖАЛОВАТЬ В БЮРО","ftueTitle":"У ВАШЕГО СЛЕДУЮЩЕГО МАТЧА ЕСТЬ НОМЕР ДЕЛА","ftueBody":"Выберите от одного до трёх контрактов, сыграйте нужный режим Deadlock и дождитесь серверного вердикта. Live-цифры — подсказка, а не самостоятельная награда.","ftueOne":"Привяжите аккаунт сайта","ftueTwo":"Зафиксируйте дело до матча","ftueThreePrefix":"Открывайте оверлей через","continue":"ВОЙТИ В HQ","pairNow":"ПРИВЯЗАТЬ АККАУНТ","ftuePrivacy":"Для проверки контрактов Companion обрабатывает SteamID, выбранные контракты, телеметрию Deadlock, состояние синхронизации и техническую диагностику. Подробнее — в Privacy.","running":"ЗАПУЩЕНА","notRunning":"НЕ ЗАПУЩЕНА","waiting":"ОЖИДАНИЕ","online":"ОНЛАЙН","offline":"ОФЛАЙН","unpaired":"НЕ ПРИВЯЗАН","connected":"ПОДКЛЮЧЕН","degraded":"ОГРАНИЧЕННО","incompatible":"НУЖНО ОБНОВИТЬ СЕРВЕР","verified":"ПОДТВЕРЖДЕНО","mismatch":"НЕСОВПАДЕНИЕ","pairFirst":"ПРИВЯЖИТЕ АККАУНТ","pairFirstBody":"Подключите официальный аккаунт Deadlock Contracts, чтобы загрузить ежедневные доски.","loading":"ЗАГРУЖАЕМ ДОСЬЕ","retry":"ПОВТОРИТЬ","noBoard":"ДОСКА НЕДОСТУПНА","noActiveCase":"НЕТ АКТИВНОГО ДЕЛА","noActiveBody":"Выберите и зафиксируйте от одного до трёх контрактов до начала матча.","openBoard":"ОТКРЫТЬ ДОСКУ","selected":"ВЫБРАН","select":"ВЫБРАТЬ","locked":"ЗАФИКСИРОВАНО","verifying":"ПРОВЕРКА","reviewRequired":"НУЖНА ПРОВЕРКА","completed":"ВЫПОЛНЕНО","failed":"ПРОВАЛЕНО","partial":"ЧАСТИЧНЫЙ ИТОГ","offered":"ПРЕДЛОЖЕНО","lockCase":"ЗАФИКСИРОВАТЬ","reroll":"ПЕРЕСОБРАТЬ","reset":"СБРОС","serverAuthority":"СЕРВЕРНЫЕ ДАННЫЕ","provisional":"LIVE / ПРЕДВАРИТЕЛЬНО","postMatch":"ПОСЛЕ МАТЧА","attempt":"ПОПЫТКА","attempts":"ПОПЫТКИ","reward":"НАГРАДА","records":"ЗАПИСЕЙ","syncComplete":"Серверные данные обновлены.","reportCopied":"Диагностический отчёт скопирован.","pairSuccess":"Аккаунт подключён.","disconnected":"Companion отключён.","enterCode":"Сначала введите pairing code.","actionFailed":"Действие не выполнено","lockTitle":"ЗАФИКСИРОВАТЬ ДЕЛО?","lockWarning":"Изменить эти контракты будет нельзя до решения или истечения доски.","rerollTitle":"ПЕРЕСОБРАТЬ ДОСКУ?","rerollWarning":"Будет использована одна общая бесплатная пересборка на сегодня.","cancel":"ОТМЕНА","confirmLock":"ЗАФИКСИРОВАТЬ","confirmReroll":"ПЕРЕСОБРАТЬ","noHistory":"ДЕЛ ПОКА НЕТ","noHistoryBody":"Зафиксированные контракты и решения по ним появятся здесь.","localEvidence":"ЛОКАЛЬНЫЕ ДАННЫЕ","serverLedger":"СЕРВЕРНЫЙ РЕЕСТР","staleCache":"ДАННЫЕ ИЗ КЭША","updated":"ОБНОВЛЕНО","personalized":"ПЕРСОНАЛЬНЫЙ","whyContract":"ПОЧЕМУ ЭТОТ КОНТРАКТ?","recentMatches":"последних подтверждённых матчей","adaptiveCold":"ОБЫЧНАЯ ДОСКА","adaptiveConsistency":"СТАБИЛЬНОСТЬ","adaptiveChallenge":"ВЫЗОВ","adaptiveMastery":"МАСТЕРСТВО","adaptiveHabit":"СМЕНА ПРИВЫЧКИ","adaptiveWildcard":"ДЖОКЕР","personalIntel":"ПЕРСОНАЛЬНОЕ ДОСЬЕ","adaptiveBody":"Серверный baseline по вашим последним подтверждённым матчам. Он меняется только после финальных матчей со статусом SCORED.","calibration":"КАЛИБРОВКА","confidence":"НАДЁЖНОСТЬ","sample":"ВЫБОРКА","median":"МЕДИАНА","strongMatch":"P75 / СИЛЬНЫЙ МАТЧ","best":"ЛУЧШЕЕ","debriefBody":"Последний матч, обработанный сервером, результат XP ledger и текущий адаптивный baseline.","noDebrief":"НЕТ ПОДТВЕРЖДЁННОГО МАТЧА","noDebriefBody":"После проверки зафиксированного дела здесь появится серверный итог.","xpGranted":"XP НАЧИСЛЕНО","xpPending":"XP ЕЩЁ В LEDGER","attemptMissed":"ПОПЫТКА НЕ УДАЛАСЬ","stillActive":"КОНТРАКТ ОСТАЁТСЯ АКТИВЕН","newVerdict":"НОВЫЙ ВЕРДИКТ","localCapture":"ЛОКАЛЬНЫЙ СНИМОК / ПРЕДВАРИТЕЛЬНО","latestServerResult":"ПОСЛЕДНИЙ СЕРВЕРНЫЙ ИТОГ","debriefNeedsServer":"Для серверного debrief с XP ledger нужен backend 0.10.1-alpha.6 или новее.","adaptiveNeedsServer":"Обновите сервер, чтобы загрузить подтверждённые adaptive-профили."})


  // Alpha.9 overrides and newly catalogued user-facing strings. Keep these
  // after the compatibility catalog so legacy keys cannot overwrite them.
  Object.assign(CATALOG.en, {
    brandSub: 'COMPANION / M.C.G.',
    qaCandidate: 'QA CANDIDATE',
    deadlockLabel: 'DEADLOCK',
    gepEvidenceLabel: 'GEP / EVIDENCE',
    identityLabel: 'IDENTITY',
    sponsoredContent: 'SPONSORED CONTENT',
    desktopAdSpace: 'DESKTOP-ONLY AD SPACE',
    adsInitialDisabled: 'AVAILABLE AFTER OVERWOLF QA ENABLES ADS',
    dailyBoardEyebrow: 'DAILY BOARD / CONTRACTS 2.0',
    liveCaseEyebrow: 'LIVE CASE / MATCH EVIDENCE',
    currentMatchEyebrow: 'CURRENT MATCH',
    postMatchEyebrow: 'POST-MATCH / SERVER VERDICT',
    archiveEyebrow: 'CASE ARCHIVE / SERVER LEDGER',
    profileEyebrow: 'OPERATIVE RECORD / SERVER VERIFIED',
    historyAll: 'ALL', historyActive: 'ACTIVE', historyCompleted: 'COMPLETED', historyFailed: 'FAILED',
    showId: 'SHOW ID', copyId: 'COPY ID', totalXp: 'TOTAL XP', successRate: 'SUCCESS RATE',
    overlayHotkeyWarning: 'Overlay hotkey is unassigned. Open Overwolf Hotkey Settings to assign one.',
    ftuePlay: 'PLAY', ftueComplete: 'COMPLETE', ftueEarn: 'EARN', authoritativeAction: 'AUTHORITATIVE ACTION',
    ftuePrivacy: 'For contract verification, Companion processes your SteamID, selected contracts, Deadlock game events, synchronization history, and technical diagnostics. Ads and their technical events run only in the desktop window. See Privacy for details.',
    overlayBody: 'A minimal input-pass-through case widget. Choose a tested size preset, reset its position, and configure auto-hide here.',
    expired: 'EXPIRED',
    voidStatus: 'VOID',
    unknownServerStatus: 'UNKNOWN SERVER STATUS',
    revokeDisconnect: 'REVOKE & DISCONNECT',
    forceLocalSignOut: 'FORCE LOCAL SIGN-OUT',
    exportPending: 'EXPORT PENDING',
    clearCache: 'CLEAR CACHE',
    clearAllData: 'CLEAR ALL LOCAL DATA',
    helpRules: 'HELP & RULES',
    privacy: 'PRIVACY',
    support: 'REPORT A PROBLEM',
    replayIntro: 'REPLAY INTRODUCTION',
    autoHide: 'AUTO-HIDE',
    never: 'NEVER',
    diagnosticsSafe: 'Diagnostics omit bearer tokens, raw GEP payloads, and full SteamID by default.',
    updateHelp: 'APP UPDATE / HELP',
    systemControl: 'SYSTEM / CONTROL',
    backgroundReady: 'BACKGROUND READY',
    notChecked: 'NOT CHECKED',
    pairingCodeLabel: 'Pairing code',
    minimize: 'Minimize',
    closeWindow: 'Close window',
    systemStatus: 'System status',
    languageLabel: 'Language',
    mainNavigation: 'Main navigation',
    lockBlockedOffline: 'Lock and reroll are unavailable while server data is offline.',
    lockBlockedStale: 'Lock and reroll require fresh compatible server data.',
    lockBlockedGep: 'Lock and reroll are paused while live GEP data is stale or unavailable during a running game.',
    progression: 'PROGRESSION', level: 'LEVEL', progress: 'PROGRESS', toNext: 'TO NEXT', toNextLevel: 'TO NEXT LEVEL', freeRerolls: 'FREE REROLLS',
    lockBlockedAttempts: 'No attempts remain for this board.',
    lockBlockedBusy: 'Wait for the current server action to finish.',
    lockBlockedSelection: 'Select 1–3 contracts before locking.',
    lockBlockedMode: 'The current mode is not known yet.',
    lockBlockedReady: 'Ready for server action.',
    draftRestored: 'Draft selection restored for this board.',
    draftNotSaved: 'Draft selection could not be saved locally.',

    unknownServerStatus: 'UNKNOWN SERVER STATUS',
    healthGame: 'GAME PROCESS', healthGep: 'LIVE DATA (GEP)', healthIdentity: 'ACCOUNT / IDENTITY', healthServer: 'SERVER / NETWORK', healthLocal: 'LOCAL STORAGE / QUEUE',
    healthOpenSettings: 'OPEN SETTINGS', healthRetry: 'RETRY', healthPair: 'PAIR ACCOUNT', healthExport: 'EXPORT PENDING',
    pairErrorExpired: 'Pairing code expired. Create a new code on the pairing page and try again.',
    pairErrorUsed: 'This pairing code has already been used. Create a new code and try again.',
    pairErrorInvalid: 'The pairing code is invalid. Enter it exactly as shown on the website.',
    pairErrorOffline: 'The server cannot be reached. Check your connection and retry.',
    pairErrorGeneric: 'Pairing failed. Create a fresh code and retry.',
    requestId: 'Request ID',
    summaryMode: 'MODE', summaryExpiry: 'BOARD EXPIRES', summaryAttempt: 'ATTEMPT AFTER LOCK', summaryReward: 'MAXIMUM REWARD', summaryDataAge: 'SERVER DATA AGE', summaryContract: 'CONTRACT',
    server: 'SERVER', deadlock: 'DEADLOCK', generation: 'GENERATION', available: 'AVAILABLE', phase: 'PHASE', versionLabel: 'VERSION', match: 'MATCH', activeSession: 'ACTIVE SESSION', noSession: 'NO SESSION', waitingDeadlock: 'WAITING FOR DEADLOCK', deadlockDetected: 'DEADLOCK DETECTED',
    overlayHotkeyUnassigned: 'Overlay hotkey is not assigned.', openHotkeySettings: 'OPEN OVERWOLF HOTKEY SETTINGS',
    copied: 'COPIED',
    privacyLink: 'https://deadlock-contracts.online/privacy',
    supportLink: 'https://deadlock-contracts.online/support',
    helpLink: 'https://deadlock-contracts.online/data-sources',
  })
  Object.assign(CATALOG.ru, {
    brandSub: 'КОМПАНЬОН / M.C.G.',
    qaCandidate: 'QA-КАНДИДАТ',
    deadlockLabel: 'DEADLOCK',
    gepEvidenceLabel: 'GEP / ДОКАЗАТЕЛЬСТВА',
    identityLabel: 'ЛИЧНОСТЬ',
    sponsoredContent: 'СПОНСОРСКИЙ КОНТЕНТ',
    desktopAdSpace: 'РЕКЛАМА ТОЛЬКО В DESKTOP',
    adsInitialDisabled: 'РЕКЛАМА ОТКЛЮЧЕНА ДЛЯ ПЕРВОГО QA',
    dailyBoardEyebrow: 'ЕЖЕДНЕВНАЯ ДОСКА / CONTRACTS 2.0',
    liveCaseEyebrow: 'АКТИВНОЕ ДЕЛО / ДАННЫЕ МАТЧА',
    currentMatchEyebrow: 'ТЕКУЩИЙ МАТЧ',
    postMatchEyebrow: 'ПОСЛЕ МАТЧА / ВЕРДИКТ СЕРВЕРА',
    archiveEyebrow: 'АРХИВ ДЕЛ / СЕРВЕРНЫЙ РЕЕСТР',
    profileEyebrow: 'ДОСЬЕ ОПЕРАТИВНИКА / ПОДТВЕРЖДЕНО СЕРВЕРОМ',
    historyAll: 'ВСЕ', historyActive: 'АКТИВНЫЕ', historyCompleted: 'ВЫПОЛНЕНЫ', historyFailed: 'ПРОВАЛЕНЫ',
    showId: 'ПОКАЗАТЬ ID', copyId: 'КОПИРОВАТЬ ID', totalXp: 'ВСЕГО XP', successRate: 'ДОЛЯ УСПЕХА',
    overlayHotkeyWarning: 'Hotkey оверлея не назначен. Откройте настройки hotkey Overwolf и назначьте клавиши.',
    ftuePlay: 'ИГРАЙ', ftueComplete: 'ВЫПОЛНЯЙ', ftueEarn: 'ПОЛУЧАЙ XP', authoritativeAction: 'НЕОБРАТИМОЕ ДЕЙСТВИЕ',
    ftuePrivacy: 'Для проверки контрактов Companion обрабатывает ваш SteamID, выбранные контракты, игровые события Deadlock, историю синхронизации и техническую диагностику. Реклама и её технические события работают только в desktop-окне. Подробнее — в Privacy.',
    overlayBody: 'Минимальный input-pass-through виджет дела. Здесь можно выбрать проверенный размер, сбросить позицию и настроить автоскрытие.',
    expired: 'ИСТЁК',
    voidStatus: 'АННУЛИРОВАНО',
    unknownServerStatus: 'НЕИЗВЕСТНЫЙ СТАТУС СЕРВЕРА',
    revokeDisconnect: 'ОТОЗВАТЬ И ОТКЛЮЧИТЬ',
    forceLocalSignOut: 'ПРИНУДИТЕЛЬНО ВЫЙТИ ЛОКАЛЬНО',
    exportPending: 'ЭКСПОРТ ОЧЕРЕДИ',
    clearCache: 'ОЧИСТИТЬ КЭШ',
    clearAllData: 'ОЧИСТИТЬ ВСЕ ЛОКАЛЬНЫЕ ДАННЫЕ',
    helpRules: 'ПОМОЩЬ И ПРАВИЛА',
    privacy: 'ПРИВАТНОСТЬ',
    support: 'СООБЩИТЬ О ПРОБЛЕМЕ',
    replayIntro: 'ПОВТОРИТЬ ВВЕДЕНИЕ',
    autoHide: 'АВТОСКРЫТИЕ',
    never: 'НИКОГДА',
    diagnosticsSafe: 'Диагностика по умолчанию не содержит bearer token, raw GEP payload и полный SteamID.',
    updateHelp: 'ОБНОВЛЕНИЕ / ПОМОЩЬ',
    systemControl: 'СИСТЕМА / УПРАВЛЕНИЕ',
    backgroundReady: 'ФОНОВЫЙ КОНТРОЛЛЕР ГОТОВ',
    notChecked: 'НЕ ПРОВЕРЕНО',
    pairingCodeLabel: 'Код привязки',
    minimize: 'Свернуть',
    closeWindow: 'Закрыть окно',
    systemStatus: 'Состояние системы',
    languageLabel: 'Язык',
    mainNavigation: 'Основная навигация',
    lockBlockedOffline: 'Фиксация и пересборка недоступны без связи с сервером.',
    lockBlockedStale: 'Для фиксации и пересборки нужны свежие совместимые данные сервера.',
    lockBlockedGep: 'Фиксация и пересборка приостановлены: во время запущенной игры live-данные GEP устарели или недоступны.',
    progression: 'ПРОГРЕСС', level: 'УРОВЕНЬ', progress: 'ПРОГРЕСС', toNext: 'ДО СЛЕДУЮЩЕГО', toNextLevel: 'ДО НОВОГО УРОВНЯ', freeRerolls: 'БЕСПЛАТНЫЕ ПЕРЕСБОРКИ',
    lockBlockedAttempts: 'Попытки для этой доски закончились.',
    lockBlockedBusy: 'Дождитесь завершения текущего серверного действия.',
    lockBlockedSelection: 'Перед фиксацией выберите 1–3 контракта.',
    lockBlockedMode: 'Текущий режим пока не определён.',
    lockBlockedReady: 'Серверное действие доступно.',
    draftRestored: 'Черновик выбора для этой доски восстановлен.',
    draftNotSaved: 'Не удалось сохранить черновик локально.',

    unknownServerStatus: 'НЕИЗВЕСТНЫЙ СТАТУС СЕРВЕРА',
    healthGame: 'ПРОЦЕСС ИГРЫ', healthGep: 'LIVE-ДАННЫЕ (GEP)', healthIdentity: 'АККАУНТ / ИДЕНТИЧНОСТЬ', healthServer: 'СЕРВЕР / СЕТЬ', healthLocal: 'ЛОКАЛЬНОЕ ХРАНИЛИЩЕ / ОЧЕРЕДЬ',
    healthOpenSettings: 'ОТКРЫТЬ НАСТРОЙКИ', healthRetry: 'ПОВТОРИТЬ', healthPair: 'ПРИВЯЗАТЬ АККАУНТ', healthExport: 'ЭКСПОРТ ОЧЕРЕДИ',
    pairErrorExpired: 'Код привязки истёк. Создайте новый код на странице привязки и повторите.',
    pairErrorUsed: 'Этот код привязки уже использован. Создайте новый код и повторите.',
    pairErrorInvalid: 'Код привязки неверный. Введите его точно как показано на сайте.',
    pairErrorOffline: 'Сервер недоступен. Проверьте соединение и повторите.',
    pairErrorGeneric: 'Не удалось выполнить привязку. Создайте новый код и повторите.',
    requestId: 'Request ID',
    summaryMode: 'РЕЖИМ', summaryExpiry: 'ДОСКА ИСТЕКАЕТ', summaryAttempt: 'ПОПЫТКА ПОСЛЕ ФИКСАЦИИ', summaryReward: 'МАКСИМАЛЬНАЯ НАГРАДА', summaryDataAge: 'ВОЗРАСТ ДАННЫХ СЕРВЕРА', summaryContract: 'КОНТРАКТ',
    server: 'СЕРВЕР', deadlock: 'DEADLOCK', generation: 'ПОКОЛЕНИЕ', available: 'ДОСТУПНО', phase: 'ФАЗА', versionLabel: 'ВЕРСИЯ', match: 'МАТЧ', activeSession: 'АКТИВНАЯ СЕССИЯ', noSession: 'НЕТ СЕССИИ', waitingDeadlock: 'ОЖИДАНИЕ DEADLOCK', deadlockDetected: 'DEADLOCK ОБНАРУЖЕН',
    overlayHotkeyUnassigned: 'Hotkey оверлея не назначен.', openHotkeySettings: 'ОТКРЫТЬ НАСТРОЙКИ HOTKEY OVERWOLF',
    copied: 'СКОПИРОВАНО',
    privacyLink: 'https://deadlock-contracts.online/privacy',
    supportLink: 'https://deadlock-contracts.online/support',
    helpLink: 'https://deadlock-contracts.online/data-sources',
  })

  // Nightshift presentation copy. Technical and contract semantics remain unchanged.
  Object.assign(CATALOG.en, {
    hq: 'Overview', contracts: 'Contracts', activeCase: 'Active case', debrief: 'Debrief', history: 'Match history', profile: 'Profile', settings: 'Settings',
    brandSub: 'COMPANION / M.C.G.', navWorkspace: 'YOUR NEXT MATCH', bureauSignal: 'YOUR BUREAU / COMPANION', operationsHq: 'Your control room.',
    hqSubtitle: 'A new goal for your next match.', nightshiftName: 'NIGHTSHIFT', nightshiftEyebrow: 'NIGHTSHIFT / YOUR NEXT MATCH',
    heroTitle: 'A good match starts with a goal.', heroBody: 'Choose a case, play your match, and let the server confirm the result. Your next objective is always close.',
    openContracts: 'Choose a contract', openActive: 'Active case', curatorTitle: 'Your next case is waiting.', curatorBody: 'Choose a goal. The Companion keeps the details close.', connectionSettings: 'Connection settings',
    appearanceEyebrow: 'YOUR COMPANION', appearanceTitle: 'Five moods. One city.', appearanceBody: 'Choose a look for the desktop and overlay. Your choice stays on this device.',
    themeLabel: 'Color theme', themeSystem: 'System', themeSystemBody: 'Follow your device', themeDark: 'Nightshift', themeDarkBody: 'Graphite and mint', themeLight: 'Daybreak', themeLightBody: 'A lighter city', themeBlack: 'Blackout', themeBlackBody: 'Quiet. Pure black.', themeCustom: 'After hours', themeCustomBody: 'Blue and amber',
    motionTitle: 'Motion', motionBody: 'System accessibility preferences are always respected.', motionSystem: 'System', motionReduced: 'Reduced',
    settingsSecurity: 'Your connection, appearance, overlay and diagnostic controls, in one place.',
    ftueTitle: 'Your next match starts here.', ftueEyebrow: 'WELCOME TO NIGHTSHIFT', continue: 'Enter the bureau', pairNow: 'Pair account',
  })
  Object.assign(CATALOG.ru, {
    hq: 'Обзор', contracts: 'Контракты', activeCase: 'Активное дело', debrief: 'Итог матча', history: 'История матчей', profile: 'Профиль', settings: 'Настройки',
    brandSub: 'COMPANION / M.C.G.', navWorkspace: 'ТВОЯ СЛЕДУЮЩАЯ ИГРА', bureauSignal: 'ЛИЧНОЕ БЮРО / COMPANION', operationsHq: 'Твой центр управления.',
    hqSubtitle: 'Новая цель для следующего матча.', nightshiftName: 'НОЧНАЯ СМЕНА', nightshiftEyebrow: 'НОЧНАЯ СМЕНА / СЛЕДУЮЩИЙ МАТЧ',
    heroTitle: 'Хороший матч начинается с цели.', heroBody: 'Выбери дело, сыграй матч и дождись подтверждения сервера. Следующая цель всегда рядом.',
    openContracts: 'Выбрать контракт', openActive: 'Активное дело', curatorTitle: 'Твоё следующее дело уже ждёт.', curatorBody: 'Выбери цель. Companion сохранит все детали.', connectionSettings: 'Настройки подключения',
    appearanceEyebrow: 'ТВОЙ COMPANION', appearanceTitle: 'Пять настроений. Один город.', appearanceBody: 'Выбери оформление окна и оверлея. Настройка сохранится на этом устройстве.',
    themeLabel: 'Цветовая тема', themeSystem: 'Системная', themeSystemBody: 'Как на устройстве', themeDark: 'Ночная смена', themeDarkBody: 'Графит и мята', themeLight: 'Рассвет', themeLightBody: 'Светлый город', themeBlack: 'Ультрачёрная', themeBlackBody: 'Тишина. Чистый чёрный.', themeCustom: 'После полуночи', themeCustomBody: 'Синий и янтарный',
    motionTitle: 'Анимации', motionBody: 'Системное уменьшение движения действует всегда.', motionSystem: 'Системные', motionReduced: 'Сокращённые',
    settingsSecurity: 'Подключение, оформление, оверлей и диагностика — в одном месте.',
    ftueTitle: 'Твой следующий матч начинается здесь.', ftueEyebrow: 'ДОБРО ПОЖАЛОВАТЬ В НОЧНУЮ СМЕНУ', continue: 'Войти в бюро', pairNow: 'Подключить аккаунт',
  })

  const METRICS = new Set([
    'player.kills','player.deaths','player.assists','player.kda','player.net_worth.final',
    'player.hero_damage','player.object_damage','player.healing','player.scoreboard_healing',
    'match.duration_s','match.win',
  ])

  function normalizeLang(value) {
    const text = String(value || '').toLowerCase()
    if (text === 'ru' || text.startsWith('ru-')) return 'ru'
    if (text === 'pseudo') return 'pseudo'
    return 'en'
  }
  function storedPreference(key) {
    if (typeof localStorage === 'undefined') return null
    const structured = root?.DCStorage?.readJson?.(key, { schemaVersion: 1 })
    if (structured?.ok && !structured.missing) return structured.value
    const legacy = localStorage.getItem(key)
    return legacy && !legacy.startsWith('{') ? legacy : null
  }
  function storePreference(key, value) {
    if (root?.DCStorage?.writeJson) return root.DCStorage.writeJson(key, value, { schemaVersion: 1 })
    return {ok:false,code:'STORAGE_UNAVAILABLE',error:'Verified storage adapter is unavailable'}
  }
  function detectedLanguage() {
    const server = storedPreference(SERVER_LANGUAGE_KEY)
    if (server === 'ru' || server === 'en') return server
    const langs = typeof navigator !== 'undefined' && Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages : [typeof navigator !== 'undefined' ? navigator.language : 'en']
    return langs.some(value => String(value).toLowerCase().startsWith('ru')) ? 'ru' : 'en'
  }
  function preference() {
    if (typeof localStorage === 'undefined') return 'en'
    const value = storedPreference(PREF_KEY)
    return ['auto','en','ru','pseudo'].includes(value) ? value : 'auto'
  }
  function language() { return preference() === 'auto' ? detectedLanguage() : preference() }
  function setPreference(value) {
    if (!['auto','en','ru','pseudo'].includes(value)) return false
    if (typeof localStorage !== 'undefined') storePreference(PREF_KEY, value)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dc:language', {detail:{preference:value, language:language()}}))
    return true
  }
  function setServerLanguage(value) {
    if (typeof localStorage === 'undefined') return
    if (value === 'ru' || value === 'en') storePreference(SERVER_LANGUAGE_KEY, value)
    else root?.DCStorage?.remove?.(SERVER_LANGUAGE_KEY) || localStorage.removeItem(SERVER_LANGUAGE_KEY)
  }
  function interpolate(template, vars = {}) {
    return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`))
  }
  function pseudo(text) {
    const expanded = String(text).replace(/[aeiouаеёиоуыэюя]/gi, '$&$&')
    return `［${expanded} ···］`
  }
  function literal(english, russian, lang = language()) {
    const normalized=normalizeLang(lang)
    const base=normalized==='ru'?String(russian):String(english)
    return normalized==='pseudo'?pseudo(String(english)):base
  }
  function t(key, lang = language(), vars = {}) {
    const normalized = normalizeLang(lang)
    const sourceLang = normalized === 'pseudo' ? 'en' : normalized
    const value = CATALOG[sourceLang]?.[key]
    if (value == null) {
      MISSING.add(`${key}:${sourceLang}`)
      return ''
    }
    const rendered = interpolate(value, vars)
    return normalized === 'pseudo' ? pseudo(rendered) : rendered
  }
  function formatNumber(value, digits = 0, lang = language()) {
    if (value === null || value === undefined || value === '') return '—'
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString(normalizeLang(lang) === 'ru' ? 'ru-RU' : 'en-US', {maximumFractionDigits: digits})
  }
  function formatDuration(seconds, lang = language()) {
    const n = Number(seconds)
    if (!Number.isFinite(n)) return '—'
    if (n % 60 === 0 && n >= 60) return t('common.minutes', lang, {target: formatNumber(n / 60, 0, lang)})
    return t('common.seconds', lang, {target: formatNumber(n, 0, lang)})
  }
  function metricLabel(metric, lang = language()) {
    return t(`metric.${metric}`, lang) || String(metric || '').replace(/[._]/g, ' ').toUpperCase()
  }
  function renderCondition(condition, lang = language()) {
    const metric = String(condition?.metric || '')
    const operator = String(condition?.operator || '')
    const target = Number(condition?.target)
    if (!METRICS.has(metric) || !['gte','lte','eq'].includes(operator) || !Number.isFinite(target)) return t('contract.untitled', lang)
    if (metric === 'match.win') return t('condition.match.win.eq', lang)
    const formatted = metric === 'match.duration_s' ? formatDuration(target, lang) : formatNumber(target, 2, lang)
    return t(`condition.${metric}.${operator}`, lang, {target: formatted}) || `${metric} ${operator} ${formatted}`
  }
  function joinConditions(items, lang = language()) {
    const list = items.filter(Boolean)
    if (list.length <= 1) return list[0] || ''
    if (list.length === 2) return t('join.and.two', lang, {a:list[0], b:list[1]})
    const conjunction = normalizeLang(lang) === 'ru' ? ' и ' : ', and '
    return `${list.slice(0,-1).join(', ')}${conjunction}${list[list.length-1]}`
  }
  function renderObjective({mode, conditions}, lang = language()) {
    const normalizedMode = String(mode || '')
    const modeText = t(`mode.${normalizedMode}`, lang) || t('mode.unknown', lang)
    return t('objective.prefix', lang, {mode: modeText, conditions: joinConditions((conditions || []).map(c => renderCondition(c, lang)), lang)})
  }
  function contractTitle(option, lang = language()) {
    const normalized = normalizeLang(lang) === 'pseudo' ? 'en' : normalizeLang(lang)
    const localized = option?.title_i18n?.[normalized]
    if (localized) return String(localized)
    const key = String(option?.title_key || '')
    const fromCatalog = key ? t(key, lang) : ''
    if (fromCatalog) return fromCatalog
    MISSING.add(`title:${option?.id || 'unknown'}:${normalized}`)
    return t('contract.untitled', lang)
  }
  function missingTranslations() { return [...MISSING].sort() }

  return {PREF_KEY, SERVER_LANGUAGE_KEY, CATALOG, METRICS, detectedLanguage, preference, language, setPreference, setServerLanguage, t, literal, formatNumber, formatDuration, metricLabel, renderCondition, renderObjective, contractTitle, missingTranslations, normalizeLang}
})
