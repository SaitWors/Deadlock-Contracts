(() => {
  const STORAGE_KEY = 'dc.ui.language'
  const copy = {
    en: {
      hq: 'HQ', contracts: 'CONTRACTS', activeCase: 'ACTIVE CASE', debrief: 'DEBRIEF', history: 'HISTORY', profile: 'PROFILE', settings: 'SETTINGS',
      createdBy: 'CREATED BY', mcg: 'MANDARIN CREATOR GROUP', bureauSignal: 'BUREAU SIGNAL / ONLINE OPERATIONS', operationsHq: 'OPERATIONS HQ',
      heroTitle: 'CHOOSE THE CASE. PLAY THE MATCH. CLOSE THE FILE.', heroBody: 'Deadlock Contracts turns ordinary matches into verified objectives. The Companion is your control room; the server keeps every verdict honest.',
      openContracts: 'OPEN CONTRACTS', openActive: 'ACTIVE CASE', contractsBody: 'Choose one to three server-issued contracts. Locking is final for this daily board.',
      verifiedLater: 'Live values are provisional. The server issues the final verdict after the match.',
      kills: 'KILLS', deaths: 'DEATHS', assists: 'ASSISTS', healing: 'HEALING', heroDamage: 'HERO DAMAGE', objectDamage: 'OBJECT DAMAGE', souls: 'SOULS', matchClock: 'MATCH CLOCK',
      serverVerdict: 'SERVER VERDICT ONLY', authorityCopy: 'The Companion records evidence but cannot complete a contract or grant XP.',
      historyBody: 'Every locked assignment and its authoritative settlement record.', profileBody: 'Identity, progression and performance by operation.', account: 'ACCOUNT',
      settingsSecurity: 'No database credentials, master keys or settlement authority live in this package.', pairTitle: 'CONNECT DEADLOCK CONTRACTS',
      pairBody: 'Create a short-lived code on the official site, then enter it here. The code is exchanged once; the resulting token is encrypted for the current Windows user.',
      connect: 'CONNECT', openWebsite: 'OPEN PAIRING PAGE', pairHelp: 'Generate a short-lived code on the official site, then enter it here.', disconnect: 'DISCONNECT', syncNow: 'SYNC NOW',
      language: 'LANGUAGE', languageBody: 'Use the system language or keep a manual choice.', overlay: 'OVERLAY', overlayBody: 'A minimal input-pass-through case widget that auto-hides after a few seconds. You can resize or reset it here.',
      showOverlay: 'SHOW / HIDE', resetPosition: 'RESET POSITION', hotkeySettings: 'HOTKEY', diagnostics: 'DIAGNOSTICS', copyReport: 'COPY REPORT',
      updateBody: 'Release updates are delivered by Overwolf.', checkUpdate: 'CHECK UPDATE', exitApp: 'EXIT APP',
      ftueEyebrow: 'WELCOME TO THE CONTRACT BUREAU', ftueTitle: 'YOUR NEXT MATCH HAS A FILE NUMBER',
      ftueBody: 'Pick one to three contracts, play the matching Deadlock mode, and wait for the server verdict. Live numbers are guidance, never a self-issued reward.',
      ftueOne: 'Pair your website account', ftueTwo: 'Lock a daily case before the match', ftueThreePrefix: 'Toggle the overlay with',
      continue: 'ENTER HQ', pairNow: 'PAIR ACCOUNT', ftuePrivacy: 'Only your own game telemetry is collected for contract verification.',
      running: 'RUNNING', notRunning: 'NOT RUNNING', waiting: 'WAITING', online: 'ONLINE', offline: 'OFFLINE', unpaired: 'UNPAIRED', connected: 'CONNECTED', degraded: 'DEGRADED', incompatible: 'SERVER UPDATE NEEDED',
      verified: 'VERIFIED', mismatch: 'MISMATCH', pairFirst: 'PAIR ACCOUNT', pairFirstBody: 'Connect your official Deadlock Contracts account to load daily boards.',
      loading: 'LOADING DOSSIER', retry: 'RETRY', noBoard: 'BOARD UNAVAILABLE', noActiveCase: 'NO ACTIVE CASE', noActiveBody: 'Choose and lock one to three contracts before the match begins.',
      openBoard: 'OPEN BOARD', selected: 'SELECTED', select: 'SELECT', locked: 'LOCKED', verifying: 'VERIFYING', reviewRequired: 'REVIEW REQUIRED', completed: 'COMPLETED', failed: 'FAILED', partial: 'PARTIAL RESULT', offered: 'OFFERED',
      lockCase: 'LOCK CASE', reroll: 'REROLL', reset: 'RESET', serverAuthority: 'SERVER AUTHORITY', provisional: 'LIVE / PROVISIONAL', postMatch: 'POST-MATCH',
      attempt: 'ATTEMPT', attempts: 'ATTEMPTS', reward: 'REWARD', records: 'RECORDS', syncComplete: 'Server data refreshed.', reportCopied: 'Diagnostic report copied.',
      pairSuccess: 'Account connected.', disconnected: 'Companion disconnected.', enterCode: 'Enter the pairing code first.', actionFailed: 'Action failed',
      lockTitle: 'LOCK THIS CASE?', lockWarning: 'You cannot change these contracts until this board settles or expires.', rerollTitle: 'REROLL THIS BOARD?', rerollWarning: 'Your one shared daily reroll will be consumed.',
      cancel: 'CANCEL', confirmLock: 'LOCK CONTRACTS', confirmReroll: 'REROLL BOARD', noHistory: 'NO CASE FILES YET', noHistoryBody: 'Locked contracts and their verdicts will appear here.',
      localEvidence: 'LOCAL EVIDENCE', serverLedger: 'SERVER LEDGER', staleCache: 'CACHED DATA', updated: 'UPDATED',
      personalized: 'PERSONALIZED', whyContract: 'WHY THIS CONTRACT?', recentMatches: 'recent verified matches', adaptiveCold: 'STANDARD BOARD', adaptiveConsistency: 'CONSISTENCY', adaptiveChallenge: 'CHALLENGE', adaptiveMastery: 'MASTERY', adaptiveHabit: 'BREAK THE HABIT', adaptiveWildcard: 'WILDCARD',
      personalIntel: 'PERSONAL INTEL', adaptiveBody: 'Server-built baseline from your verified recent matches. It changes only after final scored matches.', calibration: 'CALIBRATING', confidence: 'CONFIDENCE', sample: 'SAMPLE', median: 'MEDIAN', strongMatch: 'P75 / STRONG MATCH', best: 'BEST',
      debriefBody: 'The latest server-evaluated match, XP ledger result and current adaptive baseline.', noDebrief: 'NO VERIFIED MATCH YET', noDebriefBody: 'After a locked case is evaluated, the authoritative result will appear here.', xpGranted: 'XP GRANTED', xpPending: 'XP LEDGER PENDING', attemptMissed: 'ATTEMPT MISSED', stillActive: 'CONTRACT REMAINS ACTIVE', newVerdict: 'NEW VERDICT', localCapture: 'LOCAL CAPTURE / PROVISIONAL', latestServerResult: 'LATEST SERVER RESULT', debriefNeedsServer: 'Server 0.10.1-alpha.6 or newer is required for authoritative XP-ledger debriefs.', adaptiveNeedsServer: 'Update the server to load verified adaptive profiles.',
    },
    ru: {
      hq: 'HQ', contracts: 'КОНТРАКТЫ', activeCase: 'АКТИВНОЕ ДЕЛО', debrief: 'ИТОГ МАТЧА', history: 'ИСТОРИЯ', profile: 'ПРОФИЛЬ', settings: 'НАСТРОЙКИ',
      createdBy: 'СОЗДАНО', mcg: 'MANDARIN CREATOR GROUP', bureauSignal: 'СИГНАЛ БЮРО / ОПЕРАЦИИ ОНЛАЙН', operationsHq: 'ОПЕРАТИВНЫЙ ШТАБ',
      heroTitle: 'ВЫБЕРИ ДЕЛО. СЫГРАЙ МАТЧ. ЗАКРОЙ ПАПКУ.', heroBody: 'Deadlock Contracts превращает обычные матчи в проверяемые задания. Companion — ваш штаб, сервер — источник честного решения.',
      openContracts: 'ОТКРЫТЬ КОНТРАКТЫ', openActive: 'АКТИВНОЕ ДЕЛО', contractsBody: 'Выберите от одного до трёх серверных контрактов. Фиксация этой доски окончательна.',
      verifiedLater: 'Live-значения предварительные. Финальный вердикт после матча выносит сервер.',
      kills: 'УБИЙСТВА', deaths: 'СМЕРТИ', assists: 'ПОМОЩЬ', healing: 'ЛЕЧЕНИЕ', heroDamage: 'УРОН ГЕРОЯМ', objectDamage: 'УРОН ОБЪЕКТАМ', souls: 'ДУШИ', matchClock: 'ВРЕМЯ МАТЧА',
      serverVerdict: 'ТОЛЬКО СЕРВЕРНЫЙ ВЕРДИКТ', authorityCopy: 'Companion записывает доказательства, но не может закрыть контракт или начислить XP.',
      historyBody: 'Все зафиксированные задания и их серверные решения.', profileBody: 'Личность, прогресс и результаты по режимам.', account: 'АККАУНТ',
      settingsSecurity: 'В пакете нет ключей базы, master keys или права выносить решения.', pairTitle: 'ПОДКЛЮЧИТЬ DEADLOCK CONTRACTS',
      pairBody: 'Создайте короткоживущий код на официальном сайте и введите его здесь. Код обменивается один раз, а токен шифруется для текущего пользователя Windows.',
      connect: 'ПОДКЛЮЧИТЬ', openWebsite: 'ОТКРЫТЬ СТРАНИЦУ', pairHelp: 'Создайте короткоживущий код на официальном сайте и введите его здесь.', disconnect: 'ОТКЛЮЧИТЬ', syncNow: 'СИНХРОНИЗИРОВАТЬ',
      language: 'ЯЗЫК', languageBody: 'Используйте язык системы или сохраните ручной выбор.', overlay: 'ОВЕРЛЕЙ', overlayBody: 'Минимальный input-pass-through виджет дела, который сам скрывается через несколько секунд. Здесь можно изменить размер или сбросить позицию.',
      showOverlay: 'ПОКАЗАТЬ / СКРЫТЬ', resetPosition: 'СБРОСИТЬ ПОЗИЦИЮ', hotkeySettings: 'HOTKEY', diagnostics: 'ДИАГНОСТИКА', copyReport: 'КОПИРОВАТЬ ОТЧЁТ',
      updateBody: 'Обновления приложения доставляет Overwolf.', checkUpdate: 'ПРОВЕРИТЬ', exitApp: 'ВЫЙТИ',
      ftueEyebrow: 'ДОБРО ПОЖАЛОВАТЬ В БЮРО', ftueTitle: 'У ВАШЕГО СЛЕДУЮЩЕГО МАТЧА ЕСТЬ НОМЕР ДЕЛА',
      ftueBody: 'Выберите от одного до трёх контрактов, сыграйте нужный режим Deadlock и дождитесь серверного вердикта. Live-цифры — подсказка, а не самостоятельная награда.',
      ftueOne: 'Привяжите аккаунт сайта', ftueTwo: 'Зафиксируйте дело до матча', ftueThreePrefix: 'Открывайте оверлей через',
      continue: 'ВОЙТИ В HQ', pairNow: 'ПРИВЯЗАТЬ АККАУНТ', ftuePrivacy: 'Для проверки контрактов собирается только ваша игровая телеметрия.',
      running: 'ЗАПУЩЕНА', notRunning: 'НЕ ЗАПУЩЕНА', waiting: 'ОЖИДАНИЕ', online: 'ОНЛАЙН', offline: 'ОФЛАЙН', unpaired: 'НЕ ПРИВЯЗАН', connected: 'ПОДКЛЮЧЕН', degraded: 'ОГРАНИЧЕННО', incompatible: 'НУЖНО ОБНОВИТЬ СЕРВЕР',
      verified: 'ПОДТВЕРЖДЕНО', mismatch: 'НЕСОВПАДЕНИЕ', pairFirst: 'ПРИВЯЖИТЕ АККАУНТ', pairFirstBody: 'Подключите официальный аккаунт Deadlock Contracts, чтобы загрузить ежедневные доски.',
      loading: 'ЗАГРУЖАЕМ ДОСЬЕ', retry: 'ПОВТОРИТЬ', noBoard: 'ДОСКА НЕДОСТУПНА', noActiveCase: 'НЕТ АКТИВНОГО ДЕЛА', noActiveBody: 'Выберите и зафиксируйте от одного до трёх контрактов до начала матча.',
      openBoard: 'ОТКРЫТЬ ДОСКУ', selected: 'ВЫБРАН', select: 'ВЫБРАТЬ', locked: 'ЗАФИКСИРОВАНО', verifying: 'ПРОВЕРКА', reviewRequired: 'НУЖНА ПРОВЕРКА', completed: 'ВЫПОЛНЕНО', failed: 'ПРОВАЛЕНО', partial: 'ЧАСТИЧНЫЙ ИТОГ', offered: 'ПРЕДЛОЖЕНО',
      lockCase: 'ЗАФИКСИРОВАТЬ', reroll: 'ПЕРЕСОБРАТЬ', reset: 'СБРОС', serverAuthority: 'СЕРВЕРНЫЕ ДАННЫЕ', provisional: 'LIVE / ПРЕДВАРИТЕЛЬНО', postMatch: 'ПОСЛЕ МАТЧА',
      attempt: 'ПОПЫТКА', attempts: 'ПОПЫТКИ', reward: 'НАГРАДА', records: 'ЗАПИСЕЙ', syncComplete: 'Серверные данные обновлены.', reportCopied: 'Диагностический отчёт скопирован.',
      pairSuccess: 'Аккаунт подключён.', disconnected: 'Companion отключён.', enterCode: 'Сначала введите pairing code.', actionFailed: 'Действие не выполнено',
      lockTitle: 'ЗАФИКСИРОВАТЬ ДЕЛО?', lockWarning: 'Изменить эти контракты будет нельзя до решения или истечения доски.', rerollTitle: 'ПЕРЕСОБРАТЬ ДОСКУ?', rerollWarning: 'Будет использована одна общая бесплатная пересборка на сегодня.',
      cancel: 'ОТМЕНА', confirmLock: 'ЗАФИКСИРОВАТЬ', confirmReroll: 'ПЕРЕСОБРАТЬ', noHistory: 'ДЕЛ ПОКА НЕТ', noHistoryBody: 'Зафиксированные контракты и решения по ним появятся здесь.',
      localEvidence: 'ЛОКАЛЬНЫЕ ДАННЫЕ', serverLedger: 'СЕРВЕРНЫЙ РЕЕСТР', staleCache: 'ДАННЫЕ ИЗ КЭША', updated: 'ОБНОВЛЕНО',
      personalized: 'ПЕРСОНАЛЬНЫЙ', whyContract: 'ПОЧЕМУ ЭТОТ КОНТРАКТ?', recentMatches: 'последних подтверждённых матчей', adaptiveCold: 'ОБЫЧНАЯ ДОСКА', adaptiveConsistency: 'СТАБИЛЬНОСТЬ', adaptiveChallenge: 'ВЫЗОВ', adaptiveMastery: 'МАСТЕРСТВО', adaptiveHabit: 'СМЕНА ПРИВЫЧКИ', adaptiveWildcard: 'ДЖОКЕР',
      personalIntel: 'ПЕРСОНАЛЬНОЕ ДОСЬЕ', adaptiveBody: 'Серверный baseline по вашим последним подтверждённым матчам. Он меняется только после финальных матчей со статусом SCORED.', calibration: 'КАЛИБРОВКА', confidence: 'НАДЁЖНОСТЬ', sample: 'ВЫБОРКА', median: 'МЕДИАНА', strongMatch: 'P75 / СИЛЬНЫЙ МАТЧ', best: 'ЛУЧШЕЕ',
      debriefBody: 'Последний матч, обработанный сервером, результат XP ledger и текущий адаптивный baseline.', noDebrief: 'НЕТ ПОДТВЕРЖДЁННОГО МАТЧА', noDebriefBody: 'После проверки зафиксированного дела здесь появится серверный итог.', xpGranted: 'XP НАЧИСЛЕНО', xpPending: 'XP ЕЩЁ В LEDGER', attemptMissed: 'ПОПЫТКА НЕ УДАЛАСЬ', stillActive: 'КОНТРАКТ ОСТАЁТСЯ АКТИВЕН', newVerdict: 'НОВЫЙ ВЕРДИКТ', localCapture: 'ЛОКАЛЬНЫЙ СНИМОК / ПРЕДВАРИТЕЛЬНО', latestServerResult: 'ПОСЛЕДНИЙ СЕРВЕРНЫЙ ИТОГ', debriefNeedsServer: 'Для серверного debrief с XP ledger нужен backend 0.10.1-alpha.6 или новее.', adaptiveNeedsServer: 'Обновите сервер, чтобы загрузить подтверждённые adaptive-профили.',
    },
  }

  function detectedLanguage() {
    const languages = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language || 'en']
    return languages.some(value => String(value).toLowerCase().startsWith('ru')) ? 'ru' : 'en'
  }
  function preference() {
    const value = localStorage.getItem(STORAGE_KEY)
    return ['auto', 'en', 'ru'].includes(value) ? value : 'auto'
  }
  function language() { return preference() === 'auto' ? detectedLanguage() : preference() }
  function setPreference(value) {
    if (!['auto', 'en', 'ru'].includes(value)) return
    localStorage.setItem(STORAGE_KEY, value)
    window.dispatchEvent(new CustomEvent('dc:language', { detail: { preference: value, language: language() } }))
  }
  function t(key) { return copy[language()]?.[key] ?? copy.en[key] ?? key }
  function formatNumber(value, digits = 0) {
    const number = Number(value)
    if (!Number.isFinite(number)) return '—'
    return number.toLocaleString(language() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: digits })
  }
  function formatDateTime(value, options = {}) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat(language() === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', ...options }).format(date)
  }

  window.DCShared = { STORAGE_KEY, copy, detectedLanguage, preference, language, setPreference, t, formatNumber, formatDateTime }
})()
