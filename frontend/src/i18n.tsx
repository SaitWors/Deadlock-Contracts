import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

export type Language = "en" | "ru"
export type LanguageMode = "auto" | Language

const STORAGE_KEY = "dc.ui.language"

function browserLanguage(): Language {
  if (typeof navigator === "undefined") return "en"
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  for (const value of languages) {
    const tag = String(value || "").toLowerCase()
    if (tag === "ru" || tag.startsWith("ru-")) return "ru"
    if (tag === "en" || tag.startsWith("en-")) return "en"
  }
  return "en"
}

function storedMode(): LanguageMode {
  if (typeof window === "undefined") return "auto"
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === "en" || value === "ru" || value === "auto" ? value : "auto"
  } catch {
    return "auto"
  }
}

type LanguageContextValue = {
  language: Language
  mode: LanguageMode
  setMode: (value: LanguageMode) => void
  locale: string
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  mode: "auto",
  setMode: () => undefined,
  locale: "en-US",
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<LanguageMode>(() => storedMode())
  const [detected, setDetected] = useState<Language>(() => browserLanguage())
  const language = mode === "auto" ? detected : mode

  useEffect(() => {
    const onLanguageChange = () => setDetected(browserLanguage())
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setModeState(storedMode())
    }
    window.addEventListener("languagechange", onLanguageChange)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener("languagechange", onLanguageChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dataset.language = language
  }, [language])

  const setMode = (value: LanguageMode) => {
    setModeState(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      /* language still works for this tab */
    }
    if (value === "auto") setDetected(browserLanguage())
  }

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      mode,
      setMode,
      locale: language === "ru" ? "ru-RU" : "en-US",
    }),
    [language, mode],
  )
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { language, mode, setMode } = useLanguage()
  return (
    <div
      className={`dc-language-switch ${compact ? "compact" : ""}`}
      aria-label={language === "ru" ? "Язык интерфейса" : "Interface language"}
    >
      <button
        type="button"
        className={mode === "auto" ? "active" : ""}
        onClick={() => setMode("auto")}
        title={
          language === "ru"
            ? "Автоопределение по языку браузера"
            : "Detect from browser language"
        }
      >
        AUTO
      </button>
      <button
        type="button"
        className={mode === "en" ? "active" : ""}
        onClick={() => setMode("en")}
      >
        EN
      </button>
      <button
        type="button"
        className={mode === "ru" ? "active" : ""}
        onClick={() => setMode("ru")}
      >
        RU
      </button>
    </div>
  )
}

const EN: Record<string, string> = {
  "Открыть меню": "Open menu",
  Выйти: "Sign out",
  "Выйти из аккаунта": "Sign out",
  НОВОЕ: "NEW",
  ЗАГРУЗКА: "LOADING",
  "В СЕТИ": "ONLINE",
  "ПРИВЯЗАН · НЕ В СЕТИ": "PAIRED · OFFLINE",
  "НЕ ПОДКЛЮЧЕН": "NOT CONNECTED",
  "КОМПАНЬОН В СЕТИ": "COMPANION ONLINE",
  АВТОПРОВЕРКА: "AUTO VERIFY",
  "Связь с приложением установлена": "Companion connection established",
  "Система готова": "System ready",
  "До 9 контрактов в день · Standard, Ranked, Street Brawl. Для каждого режима — отдельное дело":
    "Up to 9 contracts per day · Standard, Ranked, Street Brawl. Each mode has its own case.",
  "Базовая доска без влияния на рейтинг Deadlock":
    "Core board with no impact on your Deadlock rank",
  "Контракты без условий, которые мешают командной игре":
    "Contracts designed not to interfere with team play",
  "Короткие контракты, настроенные под быстрый режим":
    "Short contracts tuned for the faster mode",
  "можно выбрать": "available",
  выполнено: "completed",
  "в деле": "in case",
  "контрактов всего": "contracts total",
  "контрактов зафиксировано": "contracts locked",
  "бесплатно сегодня": "free today",
  "Соберите дело": "Build your case",
  "Шесть контрактов на режим. Выберите до трёх. Каждый невыполненный контракт можно закрыть в одном из трёх подходящих матчей; прогресс между матчами не суммируется.":
    "Six contracts per mode. Choose up to three. Every unfinished contract gets up to three eligible match attempts; progress does not accumulate across matches.",
  "Каждый день в 06:00 МСК": "Every day at 06:00 MSK",
  "НЕ ПРИНЯТО": "NOT ACCEPTED",
  "24 часа с момента фиксации": "24 hours from lock-in",
  "для невыполненных контрактов": "for unfinished contracts",
  "Система сама создала внутреннюю заявку. Ничего загружать или доказывать не нужно.":
    "The system opened an internal review automatically. You do not need to upload or prove anything.",
  Все: "All",
  Бой: "Combat",
  Поддержка: "Support",
  Экономика: "Economy",
  Выживание: "Survival",
  ШАНС: "DROP",
  УСЛОВИЯ: "CONDITIONS",
  ЦЕЛЬ: "TARGET",
  НАГРАДА: "REWARD",
  ВЫБРАНО: "SELECTED",
  ДОСТУПНО: "AVAILABLE",
  "НЕ ВЫБРАНО": "NOT SELECTED",
  опыта: "XP",
  выбрано: "selected",
  "Ничего нажимать не нужно — проверка продолжится автоматически.":
    "No action is required — verification will continue automatically.",
  "Матч обнаружен": "Match detected",
  "Автоматическая проверка": "Automatic verification",
  "Данные уточняются": "Verifying final data",
  "Проверка завершена": "Verification complete",
  "Автоматический поиск матча": "Automatic match discovery",
  Дела: "Cases",
  "Каждый режим ведёт отдельную цепочку дел. Здесь хранятся Match ID, решения и полученный XP.":
    "Each mode keeps a separate case chain. Match IDs, decisions and earned XP are stored here.",
  ВСЕ: "ALL",
  "Архив пока пуст": "Case archive is empty",
  "Зафиксируйте дело и сыграйте соответствующий матч.":
    "Lock a case and play an eligible match.",
  "Дело закрыто успешно": "Case closed successfully",
  "Дело продолжается": "Case remains active",
  "Решение по делу": "Case decision",
  "ДО ЗАКРЫТИЯ": "EXPIRES IN",
  Профиль: "Profile",
  "Level здесь относится только к Deadlock Contracts и не заменяет официальный rank Deadlock":
    "Your level belongs to Deadlock Contracts only and does not replace your official Deadlock rank.",
  "Steam подключён": "Steam connected",
  "Пока нет": "None yet",
  "Основное приложение рядом с игрой. Показывает доски, активное дело и доступные игровые сигналы. Вердикт и XP всегда остаются на сервере.":
    "The primary app beside the game. It shows boards, the active case, and available game signals. Verdicts and XP always remain server-owned.",
  ЗАПУЩЕН: "RUNNING",
  "НЕ ЗАПУЩЕН": "NOT RUNNING",
  ФАЗА: "PHASE",
  РЕЖИМ: "MODE",
  "ID МАТЧА": "MATCH ID",
  "КОД ПРИВЯЗКИ": "PAIRING CODE",
  Перепривязать: "Pair again",
  "У меня уже установлен": "I already installed it",
  Отключить: "Disconnect",
  "Обновить статус": "Refresh status",
  "Установите Компаньон, затем создайте одноразовый код привязки. Сайт сохраняет резервный доступ к доскам и архиву.":
    "Install the Companion, then create a one-time pairing code. The website keeps fallback access to boards and the archive.",
  "Удаление профиля уничтожит аккаунт, контрактные доски и опыт без возможности восстановления.":
    "Deleting your profile permanently removes your account, contract boards and XP.",
  "Удалить аккаунт и все данные?": "Delete your account and all data?",
  "В одно дело можно выбрать максимум три контракта.":
    "A case can contain up to three contracts.",
  "Доска пересобрана. Бесплатная пересборка на сегодня использована.":
    "Board rerolled. Today’s free reroll has been used.",
  "Код привязки создан. Введите его в Компаньоне Deadlock Contracts.":
    "Pairing code created. Enter it in the Deadlock Contracts Companion.",
  "Отключить все привязанные устройства Компаньона?":
    "Disconnect all paired Companion devices?",
  "Компаньон отключён от аккаунта.":
    "Companion disconnected from your account.",
  "ОБНОВЛЕНИЕ УТОЧНЯЕТСЯ": "RESET PENDING",
  "ДОСКА ОБНОВЛЯЕТСЯ": "BOARD RESETTING",
  "ОБНОВЛЕНИЕ ЧЕРЕЗ": "RESET IN",
  "ДОСКА ОТКРЫТА": "BOARD OPEN",
  "ОЖИДАЕТ МАТЧ": "WAITING FOR MATCH",
  "ПОЛУЧАЕМ ДАННЫЕ": "FETCHING DATA",
  "УТОЧНЯЕМ ДАННЫЕ": "VERIFYING DATA",
  ЗАКРЫТО: "CLOSED",
  ВЫПОЛНЕНО: "COMPLETED",
  АННУЛИРОВАНО: "VOID",
  ПРОВАЛЕНО: "FAILED",
  "СРОК ИСТЁК": "EXPIRED",
  "ОЖИДАЕТ РЕШЕНИЯ": "PENDING REVIEW",
  РЕШЕНО: "RESOLVED",
  ОТКЛОНЕНО: "REJECTED",
  Инициализация: "Initializing",
  "Ожидание игроков": "Waiting for players",
  "Подготовка к матчу": "Pre-match",
  "Матч идёт": "Match in progress",
  "Матч завершён": "Match complete",
  "Неизвестная фаза": "Unknown phase",
  "Profile Studio": "Profile Studio",
  "Загружаем настройки публичного профиля…": "Loading public profile settings…",
  "Основной стиль": "Core dossier style",
  "Сдержанный архив": "Restrained archive",
  "Больше tech-акцента": "Stronger tech accent",
  "Public dossier сохранён и опубликован": "Public dossier saved and published",
  "Public dossier сохранён как private": "Public dossier saved as private",
  "Минимальный public profile: handle, bio, social links и showcase реальных контрактов. Без custom HTML, лишних widgets и отдельного визуального языка.":
    "A focused public profile: handle, bio, social links and a showcase of real verified contracts. No custom HTML, visual clutter or separate design language.",
  "Пара строк о стиле игры, героях или целях":
    "A few lines about your playstyle, heroes or goals",
  "Лучшие completed contracts появятся после первого сохранения":
    "Your best completed contracts appear after the first save",
  "Зафиксируйте 1–3 задания до матча. После игры сервис найдёт нужный матч, проверит статистику и сохранит результат.":
    "Lock 1–3 objectives before the match. Afterward, the system finds the correct match, verifies the final stats and records the result.",
  "Надёжный партнёр": "Reliable Partner",
  "Совершите не менее 10 содействий и умрите не более 7 раз.":
    "Record at least 10 assists and die no more than 7 times.",
  "В последних матчах вы часто помогали команде.":
    "Your recent matches show strong team support.",
  "Убедительные доказательства": "Convincing Evidence",
  "Нанесите героям не менее 28 000 урона.": "Deal at least 28,000 hero damage.",
  "Сильный урон героям — понятная и проверяемая цель.":
    "Strong hero damage makes for a clear, verifiable objective.",
  "Специалист: Haze": "Specialist: Haze",
  "Сыграйте на Haze и войдите в верхнюю половину команды по урону героям.":
    "Play Haze and finish in the top half of your team for hero damage.",
  "Вы давно не играли на Haze.": "You have not played Haze recently.",
  "Новые горизонты": "New Horizons",
  "Сыграйте на герое, которого не выбирали последние 5 матчей.":
    "Play a hero you have not picked in your last 5 matches.",
  "Согласованный удар": "Coordinated Strike",
  "В группе из 3+ игроков совместно возьмите не менее 2 объектов.":
    "In a party of 3+, secure at least 2 objectives together.",
  "Сезонное задание с повышенной наградой.":
    "A seasonal objective with an increased reward.",
  "Чистое досье": "Clean Dossier",
  "Завершите матч с соотношением убийств и смертей не ниже 2.0.":
    "Finish the match with a kill/death ratio of at least 2.0.",
  "Редкие задания дают больше опыта.": "Rarer contracts award more XP.",
  содействий: "assists",
  "урона героям": "hero damage",
  "2 мин назад": "2 min ago",
  "7 мин назад": "7 min ago",
  "14 мин назад": "14 min ago",
  "Архивариус I": "Archivist I",
  "Архивариус II": "Archivist II",
  "Следователь I": "Investigator I",
  "Следователь II": "Investigator II",
  "Следователь III": "Investigator III",
  "Агент III": "Agent III",
  "Гл. 4 · Испытания": "Ch. 4 · Trials",
  "Гл. 3 · Адаптация": "Ch. 3 · Adaptation",
  "Гл. 2 · Вклад": "Ch. 2 · Contribution",
  "Когда фиксируется контракт?": "When is a contract locked?",
  "До начала матча. После фиксации условия нельзя изменить; сервис ждёт следующий подходящий матч.":
    "Before the match starts. Once locked, the conditions cannot be changed; the system waits for the next eligible match.",
  "Как проверяется результат?": "How is a result verified?",
  "После матча сервис получает итоговую статистику и отдельно проверяет каждое условие.":
    "After the match, the system retrieves final stats and verifies every condition separately.",
  "Что будет, если данных не хватает?": "What if final data is missing?",
  "Сервис не засчитывает это как поражение. Он автоматически создаёт внутренний запрос на разбор; игроку не нужно загружать скриншоты или доказательства.":
    "It is not counted as a failure. The system opens an internal review automatically; the player does not need to upload screenshots or evidence.",
  "Какие режимы поддерживаются?": "Which modes are supported?",
  "Доступны Standard, Ranked и Street Brawl. Для каждого режима — свой набор и отдельное дело до трёх контрактов.":
    "Standard, Ranked and Street Brawl are supported. Each mode has its own board and a separate case of up to three contracts.",
  "Нужно ли что-то устанавливать?": "Do I need to install anything?",
  "Ничего обязательного устанавливать не нужно. Компаньон через GEP ускоряет обнаружение матча и позже позволит показывать прогресс во время игры.":
    "Nothing is required. The GEP Companion speeds up match discovery and can support live progress features later.",
  "Контракты зафиксированы": "Contracts locked",
  "Матч найден": "Match found",
  "Статистика получена": "Final stats received",
  "От поставщика статистики": "From the match data provider",
  "Условия проверены": "Conditions verified",
  "Контракт выполнен": "Contract completed",
  "Надёжный партнёр · 10 содействий, ≤7 смертей":
    "Reliable Partner · 10 assists, ≤7 deaths",
  "Содействия: 13 ≥ 10 ✓   Смерти: 5 ≤ 7 ✓":
    "Assists: 13 ≥ 10 ✓   Deaths: 5 ≤ 7 ✓",
  "Контракт ещё не зафиксирован.": "No contract locked yet.",
  "Жду ваш выбор.": "Awaiting your selection.",
  "Выберите цель до матча.": "Choose an objective before the match.",
  "Статистика не лжёт.": "The numbers do not lie.",
  "Куратор наблюдает.": "The Curator is watching.",
  "Условия зафиксированы. Ждём матч.": "Conditions locked. Awaiting match.",
  "Выберите цель на следующий матч": "Choose an objective for your next match",
  Сбросить: "Reset",
  "Зафиксировать →": "Lock contracts →",
  "Войти для выбора": "Sign in to choose",
  "Каждый шаг виден пользователю": "Every step stays visible",
  "Сервис находит подходящий матч, получает итоговую статистику и проверяет каждое условие. Если данных недостаточно, он сам создаёт внутренний запрос на разбор — игроку ничего загружать не нужно.":
    "The system finds the eligible match, retrieves final stats and checks every condition. If data is incomplete, it opens an internal review automatically — the player uploads nothing.",
  "Как проходит проверка": "How verification works",
  "МАТЧ #48291031": "MATCH #48291031",
  ОБЫЧНЫЙ: "STANDARD",
  '"Контракт — не наказание, а цель"':
    '"A contract is an objective, not a punishment"',
  "Частые вопросы": "Frequently asked questions",
  "Большие серии дел готовятся": "Long-form case campaigns are coming",
  "Сначала доводим daily boards для Standard, Ranked и Street Brawl. Кампании появятся отдельным обновлением.":
    "We are finishing the daily boards for Standard, Ranked and Street Brawl first. Campaigns will arrive in a dedicated update.",
  "Таблица лидеров после XP calibration": "Leaderboard after XP calibration",
  "Сначала соберём реальные данные по сложности, редкости и проценту выполнения контрактов. До этого момента мы намеренно не показываем выдуманную таблицу лидеров.":
    "We will calibrate difficulty, rarity and completion rates from real data first. Until then, we deliberately avoid showing a fabricated leaderboard.",
  "Лучшие агенты бюро": "Top Bureau Agents",
  "Только серверно подтверждённые результаты Deadlock Contracts. Официальный рейтинг Deadlock сюда не входит.":
    "Only server-verified Deadlock Contracts results. Official Deadlock rank is not part of this board.",
  "Не удалось загрузить таблицу лидеров.": "Could not load the leaderboard.",
  "Загружаем правила подсчёта…": "Loading scoring rules…",
  "Публичный профиль и статистика должны быть включены":
    "Public profile and stats must be enabled",
  "Загружаем таблицу лидеров…": "Loading leaderboard…",
  "Пока никто не квалифицировался": "No qualified agents yet",
  "Нужен публичный профиль с открытой статистикой и хотя бы один результат для выбранной таблицы.":
    "A public profile with visible stats and at least one result for this board is required.",
  "Leaderboard использует только награды за подтверждённые контракты. Административные корректировки XP не влияют на позицию.":
    "The leaderboard uses only rewards from verified contracts. Administrative XP adjustments do not affect placement.",
  "У следующего матча уже": "Your next match already has",
  "есть цель": "an objective",
  "Выберите контракт до поиска матча. Остальное сделает Куратор.":
    "Choose a contract before queueing. The Curator handles the rest.",
  "Неофициальный проект сообщества · Не связан с Valve Corporation":
    "Unofficial community project · Not affiliated with Valve Corporation",
  "Неофициальный проект для игроков Deadlock. Не связан с Valve Corporation.":
    "Unofficial project for Deadlock players. Not affiliated with Valve Corporation.",
  Статус: "Status",
  Изменения: "Changelog",
  "Источники данных": "Data sources",
  "Данные матчей предоставляют сторонние источники":
    "Match data is provided by third-party sources",
  "Этот public handle уже занят": "This public handle is already taken.",
  "Для twitch разрешена только официальная HTTPS-ссылка":
    "Only an official Twitch HTTPS link is allowed.",
  "Для youtube разрешена только официальная HTTPS-ссылка":
    "Only an official YouTube HTTPS link is allowed.",
  "Для telegram разрешена только официальная HTTPS-ссылка":
    "Only an official Telegram HTTPS link is allowed.",
  "Для discord разрешена только официальная HTTPS-ссылка":
    "Only an official Discord HTTPS link is allowed.",
  "Выберите от 1 до 3 контрактов.": "Choose 1 to 3 contracts.",
  "Доска уже зафиксирована.": "This board has already been locked.",
  "Бесплатная пересборка уже использована.":
    "Today’s free reroll has already been used.",
  "Профиль не найден.": "Profile not found.",
}

export function t(language: Language, text: string): string {
  return language === "en" ? EN[text] || text : text
}

const TITLE_MAP: Record<string, string> = {
  "Красная папка": "Red File",
  "Контрольный выстрел": "Final Shot",
  "Семь печатей": "Seven Seals",
  "Аргумент без возражений": "Irrefutable Argument",
  "Последний довод": "Final Argument",
  "Жёсткий протокол": "Hard Protocol",
  "Оперативная отметка": "Field Mark",
  "Дело особой важности": "Priority Case",
  "Дело повышенной важности": "High-Priority Case",
  "Сеть контактов": "Contact Network",
  "Коллективное решение": "Collective Decision",
  Связной: "Liaison",
  "Протокол поддержки": "Support Protocol",
  "Согласованные показания": "Corroborated Testimony",
  "Общий интерес": "Common Interest",
  "Надёжный партнёр": "Reliable Partner",
  "Полевой нотариус": "Field Notary",
  "Чистое досье": "Clean Dossier",
  "Холодная голова": "Cool Head",
  "Без права на ошибку": "No Room for Error",
  "Не оставлять следов": "Leave No Trace",
  "Безупречное алиби": "Perfect Alibi",
  "Тихий свидетель": "Silent Witness",
  "Под контролем": "Under Control",
  "Без лишнего шума": "Quiet Operation",
  "Без лишних следов": "Clean Exit",
  "Капитал дела": "Case Capital",
  "Рейтинговый капитал": "Ranked Capital",
  "Фонд операции": "Operations Fund",
  "Материальный интерес": "Material Interest",
  "Скрытый резерв": "Hidden Reserve",
  "Баланс доказательств": "Balance of Evidence",
  "Полный расчёт": "Full Accounting",
  "Цена вопроса": "Price of the Case",
  "Безупречная координация": "Flawless Coordination",
  "Вердикт рейтинга": "Ranked Verdict",
  "Восьмёрка на районе": "Eight on the Block",
  "Громкое заявление": "Loud Statement",
  "Десять подписей": "Ten Signatures",
  "Долгое разбирательство": "Long Proceedings",
  "Закрыть дело победой": "Close the Case with a Win",
  "Легенда квартала": "Neighborhood Legend",
  "Полевой медик": "Field Medic",
  "Пять быстрых отметок": "Five Quick Marks",
  Соучастник: "Accomplice",
  "Убедительные доказательства": "Convincing Evidence",
  "Улица запомнит": "The Street Remembers",
  "Уличная сеть": "Street Network",
  "Уличный приговор": "Street Verdict",
  "Хозяин улицы": "Own the Street",
  "Чистая улица": "Clean Street",
  "Шесть отметок": "Six Marks",
}
const SUFFIX_MAP: Record<string, string> = {
  " / двойное условие": " / Dual Condition",
  " / связанное дело": " / Linked Case",
  " / особый протокол": " / Special Protocol",
  " / составное дело": " / Composite Case",
}

export function contractTitle(title: string, language: Language): string {
  if (language === "ru") return title
  for (const [suffix, translated] of Object.entries(SUFFIX_MAP)) {
    if (title.endsWith(suffix))
      return (
        (TITLE_MAP[title.slice(0, -suffix.length)] ||
          title.slice(0, -suffix.length)) + translated
      )
  }
  return TITLE_MAP[title] || EN[title] || title
}

function formatValue(value: number, language: Language) {
  return new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value)
}

export type ContractConditionLike = {
  metric: string
  operator?: string
  target: number
}
export function conditionText(
  condition: ContractConditionLike,
  language: Language,
): string {
  const symbol =
    condition.operator === "lte" ? "≤" : condition.operator === "eq" ? "=" : "≥"
  const n = formatValue(Number(condition.target), language)
  const metric = condition.metric
  if (language === "ru") {
    if (metric === "match.win") return "победить"
    if (metric === "match.duration_s")
      return `провести в матче не менее ${formatValue(Number(condition.target) / 60, language)} мин`
    if (metric === "player.kills") return `${symbol} ${n} киллов`
    if (metric === "player.deaths") return `${symbol} ${n} смертей`
    if (metric === "player.assists") return `${symbol} ${n} ассистов`
    if (metric === "player.kda") return `KDA ${symbol} ${n}`
    if (metric === "player.net_worth.final") return `${symbol} ${n} душ`
    if (metric === "player.hero_damage") return `${symbol} ${n} урона героям`
    if (metric === "player.object_damage")
      return `${symbol} ${n} урона объектам`
    if (metric === "player.healing") return `${symbol} ${n} лечения`
    if (metric === "player.scoreboard_healing")
      return `${symbol} ${n} лечения по итоговой таблице`
  } else {
    if (metric === "match.win") return "win the match"
    if (metric === "match.duration_s")
      return `play for at least ${formatValue(Number(condition.target) / 60, language)} min`
    if (metric === "player.kills") return `${symbol} ${n} kills`
    if (metric === "player.deaths") return `${symbol} ${n} deaths`
    if (metric === "player.assists") return `${symbol} ${n} assists`
    if (metric === "player.kda") return `KDA ${symbol} ${n}`
    if (metric === "player.net_worth.final") return `${symbol} ${n} souls`
    if (metric === "player.hero_damage") return `${symbol} ${n} hero damage`
    if (metric === "player.object_damage")
      return `${symbol} ${n} objective damage`
    if (metric === "player.healing") return `${symbol} ${n} healing`
    if (metric === "player.scoreboard_healing")
      return `${symbol} ${n} scoreboard healing`
  }
  return `${metric} ${symbol} ${n}`
}

export function contractDescription(
  mode: string,
  conditions: ContractConditionLike[] | undefined,
  fallback: string,
  language: Language,
): string {
  if (language === "ru" || !conditions?.length) return fallback
  const pieces = conditions.map((item) => conditionText(item, language))
  const prefix =
    mode === "RANKED"
      ? "In your next Ranked match"
      : mode === "STREET_BRAWL"
        ? "In your next Street Brawl match"
        : "In your next Standard match"
  const body =
    pieces.length === 1
      ? pieces[0]
      : pieces.length === 2
        ? `${pieces[0]} and ${pieces[1]}`
        : `${pieces.slice(0, -1).join(", ")}, and ${pieces.at(-1)}`
  return `${prefix}: ${body}.`
}

export function localizeServerText(
  text: string | null | undefined,
  language: Language,
): string {
  if (!text || language === "ru") return text || ""
  if (EN[text]) return EN[text]
  let value = text
  value = value.replace(/^Факт:\s*/i, "Result: ")
  value = value.replace(
    /^Составной контракт: выполнено (\d+)\/(\d+) условий\.\s*/i,
    "Composite contract: $1/$2 conditions completed. ",
  )
  value = value.replace(/^Попытка (\d+)\/(\d+):\s*/i, "Attempt $1/$2: ")
  value = value.replace(
    /Осталось попыток:\s*(\d+)\./gi,
    "Attempts remaining: $1.",
  )
  value = value.replace(
    /Недостаточно итоговых данных:/gi,
    "Missing final match data:",
  )
  value = value.replace(
    /^Матч найден\. Ждём итоговые данные провайдера:\s*/i,
    "Match found. Waiting for final provider data: ",
  )
  value = value.replace(
    /Попытка сохранена и не будет потрачена повторно\./gi,
    "The attempt is saved and will not be spent again.",
  )
  value = value.replace(
    /Игрок не найден в составе матча\./gi,
    "Player was not found in the match roster.",
  )
  value = value.replace(
    /Матч ещё не получил надёжный сигнал завершения\./gi,
    "The match has not received a trusted completion signal yet.",
  )
  value = value.replace(
    /Длительность матча не проходит минимальную проверку целостности\./gi,
    "Match duration failed the minimum integrity check.",
  )
  value = value.replace(
    /Не удалось надёжно определить режим матча\./gi,
    "The match mode could not be verified reliably.",
  )
  value = value.replace(
    /Матч имеет статус ([A-Z_]+); требуется внутреннее решение\./g,
    "Match status is $1; internal review is required.",
  )
  value = value.replace(
    /Источник не предоставил метрику ([\w.]+); ноль не подставлялся\./g,
    "The provider did not supply $1; zero was not substituted.",
  )
  value = value.replace(/победа/gi, "win").replace(/поражение/gi, "loss")
  value = value.replace(/(\d[\d\s.,]*)\s*киллов/gi, "$1 kills")
  value = value.replace(/(\d[\d\s.,]*)\s*смертей/gi, "$1 deaths")
  value = value.replace(/(\d[\d\s.,]*)\s*ассистов/gi, "$1 assists")
  value = value.replace(/(\d[\d\s.,]*)\s*душ/gi, "$1 souls")
  value = value.replace(/(\d[\d\s.,]*)\s*урона героям/gi, "$1 hero damage")
  value = value.replace(
    /(\d[\d\s.,]*)\s*урона объектам/gi,
    "$1 objective damage",
  )
  value = value.replace(/(\d[\d\s.,]*)\s*лечения/gi, "$1 healing")
  value = value.replace(/(\d[\d\s.,]*)\s*мин\b/gi, "$1 min")
  return value
}

export function MCGCredit({
  language,
  compact = false,
}: {
  language: Language
  compact?: boolean
}) {
  return (
    <a
      className={`dc-mcg-credit ${compact ? "compact" : ""}`}
      href="https://t.me/MandarinCreatorGroup"
      target="_blank"
      rel="noreferrer"
    >
      <span>{language === "ru" ? "СОЗДАНО КОМАНДОЙ" : "CREATED BY"}</span>
      <b>M.C.G.</b>
      <em>MANDARIN CREATOR GROUP ↗</em>
    </a>
  )
}
