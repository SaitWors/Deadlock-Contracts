import BureauAtmosphere from "./BureauAtmosphere"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import BureauHeader from "./BureauHeader"
import Icon, { type IconName } from "./icons/Icon"
import CollectionPreview from "./CollectionPreview"
import matchCity from "./imports/city/uptown_02.webp"
import { useReducedMotion } from "./Appearance"
import { useSceneEntrance } from "./motion"
import { usePublicNavigation } from "./public-navigation"
import PublicContent, { readPublicCopy } from "./PublicContent"
import { MCGCredit, matchModeLabel, useLanguage } from "./i18n"
import { publicUrl, resolvePublicRoute, type PublicPage } from "./publicRoutes"
import type { NavigationIconName } from "./icons/NavigationIcon"
import "./guest-journey.css"

const ContractSigning = lazy(() => import("./ContractSigning"))
const Leaderboard = lazy(() => import("./community/Leaderboard"))
type Mode = "STANDARD" | "RANKED" | "STREET_BRAWL"
type ExampleContract = {
  id: number
  title: [string, string]
  description: [string, string]
  category: [string, string]
  difficulty: [string, string]
  icon: IconName
  reward: number
}
const EXAMPLES: ExampleContract[] = [
  {
    id: 1,
    title: ["Веский аргумент", "A strong argument"],
    description: [
      "Нанеси героям противника не менее 30 000 урона за один матч.",
      "Deal at least 30,000 damage to enemy heroes in one match.",
    ],
    category: ["УРОН", "DAMAGE"],
    difficulty: ["Средний", "Standard"],
    icon: "target",
    reward: 180,
  },
  {
    id: 2,
    title: ["Надёжное плечо", "Someone to count on"],
    description: [
      "Помоги команде совершить не менее 12 убийств за один матч.",
      "Record at least 12 assists in one match.",
    ],
    category: ["КОМАНДА", "TEAMWORK"],
    difficulty: ["Лёгкий", "Easy"],
    icon: "handshake",
    reward: 120,
  },
  {
    id: 3,
    title: ["Охотник за головами", "Bounty hunter"],
    description: [
      "Соверши не менее 8 убийств героев за один матч.",
      "Eliminate at least 8 enemy heroes in one match.",
    ],
    category: ["УБИЙСТВА", "ELIMINATIONS"],
    difficulty: ["Средний", "Standard"],
    icon: "target",
    reward: 200,
  },
  {
    id: 4,
    title: ["Сухой расчёт", "Calculated risk"],
    description: [
      "Заверши матч с не более чем 5 смертями.",
      "Finish a match with no more than 5 deaths.",
    ],
    category: ["ВЫЖИВАНИЕ", "SURVIVAL"],
    difficulty: ["Сложный", "Hard"],
    icon: "shield-check",
    reward: 240,
  },
  {
    id: 5,
    title: ["Чувство локтя", "Together we stand"],
    description: [
      "Заверши матч с не менее чем 20 содействиями.",
      "Finish a match with at least 20 assists.",
    ],
    category: ["КОМАНДА", "TEAMWORK"],
    difficulty: ["Сложный", "Hard"],
    icon: "users",
    reward: 260,
  },
  {
    id: 6,
    title: ["Без права на ошибку", "Make every shot count"],
    description: [
      "Нанеси героям не менее 45 000 урона за один матч.",
      "Deal at least 45,000 damage to enemy heroes in one match.",
    ],
    category: ["УРОН", "DAMAGE"],
    difficulty: ["Сложный", "Hard"],
    icon: "target",
    reward: 280,
  },
]

function SignIn({ compact = false }: { compact?: boolean }) {
  const { language } = useLanguage()
  return (
    <a
      className="bureau-steam-button btn-primary ritual-steam"
      href="/auth/steam"
      aria-label={language === "ru" ? "Войти через Steam" : "Sign in with Steam"}
    >
      <Icon name="user-round" size={17} />
      {compact
        ? language === "ru"
          ? "Войти"
          : "Sign in"
        : language === "ru"
          ? "Войти через Steam"
          : "Sign in with Steam"}
    </a>
  )
}

export default function Landing() {
  const { language } = useLanguage()
  const ru = language === "ru"
  const lang = ru ? 0 : 1
  const { pathname } = usePublicNavigation()
  const route = resolvePublicRoute(pathname) || {
    page: "home" as PublicPage,
    language,
  }
  const page = route.page
  const hero = useRef<HTMLElement>(null)
  const selectionSummary = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  useSceneEntrance(hero, page, reducedMotion)
  const copy = readPublicCopy({ page, language })
  const [selected, setSelected] = useState<number[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("STANDARD")
  useEffect(() => {
    setSelected([])
    setPreviewOpen(false)
    setMode("STANDARD")
  }, [page, language])
  const boardPage = page === "contracts" || page === "try"
  const total = EXAMPLES.filter((c) => selected.includes(c.id)).reduce(
    (sum, c) => sum + c.reward,
    0,
  )
  const toggle = (id: number) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length < 3
          ? [...current, id]
          : current,
    )
  const nav: { id: PublicPage; label: string; icon: NavigationIconName }[] = [
    { id: "contracts", label: ru ? "Контракты" : "Contracts", icon: "contracts" },
    { id: "cards", label: ru ? "Коллекция" : "Collection", icon: "cards" },
    { id: "leaderboards", label: ru ? "Рейтинг" : "Leaderboard", icon: "leaderboards" },
    { id: "how", label: ru ? "Как играть" : "How it works", icon: "how" },
    { id: "about", label: ru ? "О проекте" : "About", icon: "about" },
  ]
  const board = (
    <section
      className={`ritual-board ritual-container guest-board ${boardPage ? "guest-board-page" : ""}`}
      id="contract-board"
      aria-labelledby="board-title"
    >
      <div className="ritual-section-heading">
        <div>
          <p className="ritual-kicker">
            {ru ? "ЦЕЛЬ НА СЛЕДУЮЩИЙ МАТЧ" : "YOUR NEXT MATCH STARTS HERE"}
          </p>
          <h2 id="board-title">{ru ? "Выбери своё дело" : "Choose your next case"}</h2>
        </div>
        <span className="ritual-demo">
          <Icon name="eye" size={15} />
          {ru ? "Демонстрационная доска" : "Demo board"}
        </span>
      </div>
      <div className="ritual-board-toolbar">
        <fieldset className="ritual-modes guest-modes">
          <legend className="sr-only">{ru ? "Режим игры" : "Game mode"}</legend>
          {(["STANDARD", "RANKED", "STREET_BRAWL"] as Mode[]).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="demo-match-mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m)
                  setSelected([])
                }}
              />
              <span>{matchModeLabel(m, language)}</span>
            </label>
          ))}
        </fieldset>
        <p>
          {ru
            ? "Выбери до трёх контрактов на один матч"
            : "Choose up to three contracts for one match"}
        </p>
      </div>
      <div className="guest-board-workspace">
        <div
          className="ritual-contracts"
          aria-describedby="guest-selection-help guest-demo-note"
          onFocusCapture={(event) => {
            const card = event.target
            if (!(card instanceof HTMLButtonElement) || !card.matches(":focus-visible")) return
            const bounds = card.getBoundingClientRect()
            if (bounds.height <= 0) return
            const header = card.closest(".ritual-public")?.querySelector(".bureau-header")
            const top = Math.max(0, header?.getBoundingClientRect().bottom ?? 0)
            const summary = selectionSummary.current?.getBoundingClientRect()
            const bottom =
              summary && summary.height > 0 && summary.bottom > 0
                ? Math.min(window.innerHeight, summary.top)
                : window.innerHeight
            // Native focus scrolling does not account for an overlapping sticky dock.
            // Repair only keyboard focus; selecting a card with a pointer stays in place.
            if (bounds.top < top + 8 || bounds.bottom > bottom - 8)
              card.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" })
          }}
        >
          {EXAMPLES.map((c, i) => (
            <button
              type="button"
              data-contract-choice={c.id}
              key={c.id}
              className={`ritual-contract ${selected.includes(c.id) ? "is-selected" : ""}`}
              aria-pressed={selected.includes(c.id)}
              aria-describedby={
                selected.length === 3 && !selected.includes(c.id)
                  ? "guest-selection-help"
                  : undefined
              }
              disabled={selected.length === 3 && !selected.includes(c.id)}
              onClick={() => toggle(c.id)}
            >
              <span className="ritual-contract-top">
                <span>DC / {String(i + 1).padStart(3, "0")}</span>
                <span className="ritual-choice-check">
                  <Icon name={selected.includes(c.id) ? "check" : "plus"} size={17} />
                </span>
              </span>
              <span className="ritual-contract-category">
                <Icon name={c.icon} size={17} />
                {c.category[lang]}
              </span>
              <strong>{c.title[lang]}</strong>
              <span className="ritual-contract-description">{c.description[lang]}</span>
              <span className="ritual-contract-bottom">
                <span>{c.difficulty[lang]}</span>
                <b>
                  +{c.reward} <small>XP</small>
                </b>
              </span>
            </button>
          ))}
        </div>
        <div
          ref={selectionSummary}
          className="ritual-selection guest-selection"
          role="region"
          aria-label={ru ? "Выбранные контракты" : "Selected contracts"}
        >
          <div className="guest-selection-copy" role="status" aria-atomic="true">
            <div className="guest-selection-total">
              <span>
                {ru ? "Выбрано" : "Selected"} <strong>{selected.length} / 3</strong>
              </span>
              <span className="ritual-selection-xp">
                +{total} <span>XP</span>
              </span>
            </div>
            <p id="guest-selection-help">
              {selected.length === 3
                ? ru
                  ? "Чтобы заменить контракт, сними один из выбранных."
                  : "Deselect a contract to choose a different one."
                : selected.length === 0
                  ? ru
                    ? "Выбери 1–3 контракта и попробуй подписать."
                    : "Choose 1–3 contracts to try signing."
                  : ru
                    ? "Можно подписать выбор или добавить ещё."
                    : "Preview your selection or add another contract."}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={!selected.length}
            aria-describedby="guest-selection-help guest-demo-note"
            onClick={() => setPreviewOpen(true)}
          >
            <Icon name="feather" size={18} />
            {ru ? "Примерить подпись" : "Preview signing"}
            <Icon name="arrow-up-right" size={18} />
          </button>
        </div>
      </div>
      <p className="ritual-board-note" id="guest-demo-note">
        <Icon name="info" size={15} />
        {ru
          ? "Демо: выбор не сохраняется, XP не начисляется. После входа через Steam появится твоя доска контрактов."
          : "Demo: your selection is not saved and no XP is awarded. Sign in with Steam to see your contract board."}
      </p>
    </section>
  )

  return (
    <div className="bureau-public ritual-public">
      <BureauAtmosphere />
      <a className="ritual-skip" href="#main-content">
        {ru ? "К содержимому" : "Skip to content"}
      </a>
      <BureauHeader
        items={nav.map((item) => ({ ...item, href: publicUrl(item.id, language) }))}
        active={page === "try" ? "contracts" : page}
        homeHref={publicUrl("home", language)}
        onNavigate={(id) => window.location.assign(publicUrl(id as PublicPage, language))}
        actions={<SignIn compact />}
      />
      <main id="main-content">
        {page === "home" && (
          <>
            <section ref={hero} className="ritual-hero" aria-labelledby="ritual-title">
              <div className="ritual-container ritual-hero-inner">
                <div className="ritual-hero-copy">
                  <div className="ritual-hero-eyebrow">
                    <span />
                    {ru ? "ДРУГАЯ СТОРОНА DEADLOCK" : "THE OTHER SIDE OF DEADLOCK"}
                    <small>ALPHA</small>
                  </div>
                  <h1 id="ritual-title" data-intro>
                    <span className="sr-only">Deadlock Contracts: </span>
                    {ru ? (
                      <>
                        Твой матч <br />
                        <em>Твои условия</em>
                      </>
                    ) : (
                      <>
                        Your match <br />
                        <em>Your terms</em>
                      </>
                    )}
                  </h1>
                  <p>
                    {ru
                      ? "Выбери до трёх заданий и подпиши их до матча в Deadlock. Выполни условия — получи XP после проверки результата."
                      : "Choose up to three objectives and sign them before your Deadlock match. Complete the terms to earn XP after the result is verified."}
                  </p>
                  <div className="ritual-hero-actions" data-intro>
                    <a className="btn-primary" href={publicUrl("contracts", language)}>
                      {ru ? "Выбрать контракт" : "Choose a contract"}
                      <Icon name="arrow-up-right" size={20} />
                    </a>
                    <a className="ritual-text-link btn-ghost" href={publicUrl("how", language)}>
                      <Icon name="video" size={17} />
                      {ru ? "Как это работает" : "How it works"}
                    </a>
                  </div>
                  <div className="ritual-hero-trust">
                    <Icon name="shield-check" size={16} />
                    {ru
                      ? "Вход через Steam. Прогресс остаётся с тобой."
                      : "Sign in with Steam. Make your progress count."}
                  </div>
                </div>
                <div className="ritual-objective" data-intro>
                  <div className="ritual-objective-top">
                    <span>
                      <Icon name="target" size={16} /> {ru ? "КОНТРАКТ НА МАТЧ" : "MATCH CONTRACT"}
                    </span>
                    <small>{ru ? "ПРИМЕР" : "PREVIEW"}</small>
                  </div>
                  <div className="ritual-objective-body">
                    <span className="ritual-objective-id">
                      DC / 001 <span>{ru ? "УРОН" : "DAMAGE"}</span>
                    </span>
                    <h2>{EXAMPLES[0].title[lang]}</h2>
                    <p>{EXAMPLES[0].description[lang]}</p>
                    <div className="ritual-objective-target">
                      <img
                        src={matchCity}
                        alt=""
                        width="1920"
                        height="1056"
                        fetchPriority="high"
                        decoding="async"
                      />
                      <Icon name="target" size={44} />
                      <div>
                        <strong>30 000</strong>
                        <span>{ru ? "урона по героям за матч" : "hero damage in one match"}</span>
                      </div>
                    </div>
                    <div className="ritual-objective-meta">
                      <span>{ru ? "Средняя сложность" : "Standard difficulty"}</span>
                      <strong>
                        +180 <small>XP</small>
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setSelected([1])
                        setPreviewOpen(true)
                      }}
                    >
                      {ru ? "Посмотреть контракт" : "Preview contract"}
                      <Icon name="arrow-up-right" size={17} />
                    </button>
                  </div>
                  <div className="ritual-objective-foot">
                    <Icon name="shield-check" size={15} />
                    {ru
                      ? "Твои условия фиксируются до матча"
                      : "Your conditions are locked before the match"}
                  </div>
                </div>
              </div>
              <div className="ritual-hero-bottom ritual-container">
                <span>
                  01 — {ru ? "КОНТРАКТЫ НА СЛЕДУЮЩИЙ МАТЧ" : "CONTRACTS FOR YOUR NEXT MATCH"}
                </span>
                <a href="#contract-board">
                  {ru ? "Листай, здесь твоё дело" : "Your next case is below"}
                  <Icon name="arrow-down" size={15} />
                </a>
              </div>
            </section>
            <section
              className="ritual-principles ritual-container"
              aria-label={ru ? "Как работает прогресс" : "How progression works"}
            >
              {(
                [
                  [
                    "file-text",
                    ru ? "Выбирай осознанно" : "Choose your objective",
                    ru
                      ? "До трёх целей. Один матч. Твой стиль игры."
                      : "Up to three objectives. One match. Your playstyle.",
                  ],
                  [
                    "feather",
                    ru ? "Скрепляй подписью" : "Put your name on it",
                    ru
                      ? "Условия зафиксированы до начала игры."
                      : "Your conditions are locked before the match.",
                  ],
                  [
                    "medal",
                    ru ? "Собирай достижения" : "Make progress",
                    ru
                      ? "Проверенный результат, опыт и новые уровни."
                      : "Verified results, XP and new levels.",
                  ],
                ] as [IconName, string, string][]
              ).map(([icon, title, text], i) => (
                <article key={title}>
                  <span className="ritual-step-number">0{i + 1}</span>
                  <Icon name={icon} size={23} />
                  <div>
                    <h2>{title}</h2>
                    <p>{text}</p>
                  </div>
                </article>
              ))}
            </section>
            {board}
            <section className="ritual-daily ritual-container" aria-labelledby="daily-title">
              <CollectionPreview language={language} />
              <div>
                <p className="ritual-kicker">
                  {ru ? "ВОЗВРАЩАТЬСЯ ПРИЯТНО" : "SOMETHING TO COME BACK TO"}
                </p>
                <h2 id="daily-title">{ru ? "Новый день\nНовый пак" : "A new day\nA new pack"}</h2>
                <p>
                  {ru
                    ? "Ежедневный пак для твоей коллекции. Забирай бесплатно, открывай карточки героев и находи свои редкие экземпляры."
                    : "A daily pack for your collection. Claim it for free, reveal hero cards and find your next rare favorite."}
                </p>
                <a className="ritual-text-link" href={publicUrl("cards", language)}>
                  {ru ? "Больше о коллекции" : "Explore the collection"}
                  <Icon name="arrow-up-right" size={18} />
                </a>
                <span className="ritual-daily-label">
                  <Icon name="calendar-days" size={16} />
                  {ru ? "Один пак в день · Бесплатно" : "One pack a day · Free"}
                </span>
              </div>
            </section>
            <section className="ritual-community ritual-container">
              <div>
                <p className="ritual-kicker">MANDARIN CREATOR GROUP</p>
                <h2>{ru ? "У каждого игрока\nсвоя история" : "Every player\nhas a story"}</h2>
                <p>
                  {ru
                    ? "Твой профиль, твои достижения и люди, с которыми хочется сыграть ещё один матч."
                    : "Your profile, your achievements and the people who make one more match worth playing."}
                </p>
                <SignIn />
              </div>
              <div className="ritual-community-links">
                {(
                  [
                    [
                      "cards",
                      "layers",
                      ru ? "Коллекция героев" : "Hero collection",
                      ru ? "Новые карточки каждый день" : "New cards every day",
                    ],
                    [
                      "leaderboards",
                      "medal",
                      ru ? "Рейтинг игроков" : "Player leaderboard",
                      ru ? "Прогресс, который виден" : "Progress you can see",
                    ],
                    [
                      "how",
                      "users",
                      ru ? "Больше, чем матч" : "More than a match",
                      ru
                        ? "Достижения, профиль и сообщество"
                        : "Achievements, profile and community",
                    ],
                  ] as [PublicPage, IconName, string, string][]
                ).map(([id, icon, title, text]) => (
                  <a key={id} href={publicUrl(id, language)}>
                    <Icon name={icon} size={22} />
                    <span>
                      <strong>{title}</strong>
                      <small>{text}</small>
                    </span>
                    <Icon name="arrow-up-right" size={18} />
                  </a>
                ))}
              </div>
            </section>
          </>
        )}
        {boardPage && (
          <>
            <header className="ritual-page-heading ritual-container">
              <p className="ritual-kicker">DEADLOCK CONTRACTS / {ru ? "КОНТРАКТЫ" : "CONTRACTS"}</p>
              <h1>
                {copy?.heading ||
                  (ru ? "У следующего матча есть цель" : "Give your next match a purpose")}
              </h1>
              <p>{copy?.intro}</p>
            </header>
            {board}
          </>
        )}
        {page === "cards" && (
          <>
            <PublicContent copy={copy ? { ...copy, sections: [] } : null} />
            <section className="ritual-collection-callout ritual-container">
              <CollectionPreview language={language} detailed />
              <div>
                <p className="ritual-kicker">{ru ? "ЕЖЕДНЕВНЫЙ ПАК" : "DAILY PACK"}</p>
                <h2>{ru ? "Забирай, открывай, собирай" : "Claim, reveal, collect"}</h2>
                <p>
                  {ru
                    ? "Открой пак, сохрани находки в коллекции и выбери любимые карточки для своего профиля."
                    : "Open a pack, keep your finds in the collection and choose your favorites for your profile."}
                </p>
                <SignIn />
              </div>
            </section>
            <PublicContent
              copy={copy}
              heading={false}
              compact
              summary={ru ? "Как устроена коллекция" : "How the collection works"}
            />
          </>
        )}
        {!boardPage && !["home", "cards", "leaderboards"].includes(page) && (
          <PublicContent copy={copy} />
        )}
        {page === "leaderboards" && (
          <>
            <PublicContent copy={copy ? { ...copy, sections: [] } : null} />
            <div className="ritual-container ritual-ranking">
              <Suspense
                fallback={
                  <p role="status">{ru ? "Загружаем рейтинг…" : "Loading the leaderboard…"}</p>
                }
              >
                <Leaderboard />
              </Suspense>
            </div>
            <PublicContent
              copy={copy}
              heading={false}
              compact
              summary={ru ? "Как считается рейтинг" : "How standings work"}
            />
          </>
        )}
        {page === "how" && (
          <div className="ritual-container ritual-how-action">
            <a className="btn-primary" href={publicUrl("contracts", language)}>
              {ru ? "Попробовать подписание" : "Try signing"}
              <Icon name="feather" size={17} />
            </a>
          </div>
        )}
      </main>
      <footer className="ritual-footer ritual-container">
        <a className="ritual-footer-brand" href={publicUrl("home", language)}>
          <Icon name="eye" size={27} />
          <strong>
            DEADLOCK <span>CONTRACTS</span>
          </strong>
        </a>
        <p>
          {ru
            ? "Неофициальный проект сообщества. Deadlock и Steam принадлежат Valve."
            : "An unofficial community project. Deadlock and Steam belong to Valve."}
        </p>
        <nav aria-label={ru ? "Информация" : "Information"}>
          <a href="/data-sources">{ru ? "Источники данных" : "Data sources"}</a>
          <a href="/support">{ru ? "Поддержка" : "Support"}</a>
          <a href="/privacy">{ru ? "Конфиденциальность" : "Privacy"}</a>
          <a href="/terms">{ru ? "Правила" : "Terms"}</a>
        </nav>
        <MCGCredit language={language} />
      </footer>
      {previewOpen && (
        <Suspense
          fallback={
            <p role="status" className="ns-dialog-loading">
              {ru ? "Открываем контракт…" : "Opening contract…"}
            </p>
          }
        >
          <ContractSigning
            preview
            mode={mode}
            operator={ru ? "Гость" : "Guest"}
            options={EXAMPLES.filter((c) => selected.includes(c.id)).map((c) => ({
              id: String(c.id),
              title: c.title[lang],
              description: c.description[lang],
              reward: c.reward,
            }))}
            changed={false}
            onClose={() => setPreviewOpen(false)}
            onSignIn={() => window.location.assign("/auth/steam")}
          />
        </Suspense>
      )}
    </div>
  )
}
