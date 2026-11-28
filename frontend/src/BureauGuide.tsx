import { useId } from "react"
import { useLanguage } from "./i18n"
import { useResource } from "./community/api"
import Icon, { type IconName } from "./icons/Icon"
import matchCity from "./imports/city/uptown_02.webp"
import city from "./imports/city/header_city.webp"
import { publicUrl } from "./publicRoutes"
import guideCopyUrl from "./foundation/guide-copy.json?url&no-inline"
import "./bureau-guide.css"

type GuideSection = "quests" | "active" | "history" | "packs" | "profile" | "collection"
type Navigate = (section: GuideSection) => void
type Copy = [ru: string, en: string]
type GuideCopy = {
  steps: { icon: IconName; title: Copy; description: Copy; image?: "match" }[]
  questions: { question: Copy; answer: Copy; support?: boolean }[]
}

export default function BureauGuide({
  onNavigate,
  onBack,
  onResume,
}: {
  onNavigate?: Navigate
  onBack?: () => void
  onResume?: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const copy = (text: Copy) => text[ru ? 0 : 1]
  const { data, loading, reload } = useResource<GuideCopy>(guideCopyUrl, {
    reloadOnLanguageChange: false,
  })
  const heading = useId()
  const boardLabel = ru ? "Открыть доску" : "Open contract board"
  const boardAction = onNavigate ? (
    <button
      type="button"
      className="guide-button guide-button-primary"
      onClick={() => onNavigate("quests")}
    >
      <Icon name="file-text" size={17} />
      {boardLabel}
    </button>
  ) : (
    <a className="guide-button guide-button-primary" href={publicUrl("contracts", language)}>
      <Icon name="file-text" size={17} />
      {ru ? "Посмотреть контракты" : "Browse contracts"}
    </a>
  )

  return (
    <section className="foundation-guide" aria-labelledby={heading}>
      <header className="guide-hero">
        <img className="guide-hero-art" src={city} alt="" decoding="async" />
        <div>
          <h1 id={heading}>{ru ? "Как это работает" : "How it works"}</h1>
          <p>
            {ru
              ? "Выбери цель до матча, подпиши дело и получи результат после проверки. Между матчами собирай карточки героев."
              : "Pick an objective before the match, sign a case, and get your result after verification. Collect hero cards between matches."}
          </p>
          <div className="guide-actions">
            {boardAction}
            {onBack ? (
              <button type="button" className="guide-button" onClick={onBack}>
                {ru ? "К обзору" : "Back to overview"}
              </button>
            ) : (
              <a className="guide-button" href="/auth/steam">
                {ru ? "Войти через Steam" : "Sign in with Steam"}
              </a>
            )}
            {onResume && (
              <button type="button" className="guide-button" onClick={onResume}>
                {ru ? "Продолжить обучение" : "Resume onboarding"}
              </button>
            )}
          </div>
        </div>
      </header>
      {!data && (
        <div role={loading ? "status" : "alert"}>
          <p>
            {loading
              ? ru
                ? "Загружаем справку…"
                : "Loading the guide…"
              : ru
                ? "Не удалось загрузить справку."
                : "Could not load the guide."}
          </p>
          {!loading && (
            <button type="button" className="guide-button" onClick={reload}>
              {ru ? "Повторить" : "Try again"}
            </button>
          )}
        </div>
      )}
      {data && (
        <>
          <h2>{ru ? "От выбора режима до награды" : "From choosing a mode to earning a reward"}</h2>
          <ol className="guide-journey" role="list">
            {data.steps.map((item) => (
              <li key={item.icon}>
                <h3>{copy(item.title)}</h3>
                <div className="guide-step-visual">
                  {item.image ? (
                    <img src={matchCity} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <Icon name={item.icon} size={31} />
                  )}
                </div>
                <p>{copy(item.description)}</p>
              </li>
            ))}
          </ol>
          <div className="guide-lower">
            <section className="guide-links">
              <div className="guide-links-intro">
                <img
                  src="/static/assets/ritual/sealed-scroll.webp"
                  alt=""
                  loading="lazy"
                  width={84}
                  height={92}
                />
                <div>
                  <h2>{ru ? "Попробуй на практике" : "Try it for yourself"}</h2>
                  <p>
                    {ru
                      ? "Выбери режим и прочитай условия первого контракта."
                      : "Choose a mode and read the conditions of your first contract."}
                  </p>
                </div>
              </div>
              {onNavigate ? (
                <div className="guide-section-links">
                  <button
                    type="button"
                    className="guide-button"
                    onClick={() => onNavigate("active")}
                  >
                    <Icon name="briefcase-business" size={17} />
                    {ru ? "Активное дело" : "Active case"}
                  </button>
                  <button
                    type="button"
                    className="guide-button"
                    onClick={() => onNavigate("packs")}
                  >
                    <Icon name="mail" size={17} />
                    {ru ? "Ежедневный конверт" : "Daily pack"}
                  </button>
                  <button
                    type="button"
                    className="guide-button"
                    onClick={() => onNavigate("collection")}
                  >
                    <Icon name="layers" size={17} />
                    {ru ? "Моя коллекция" : "My collection"}
                  </button>
                </div>
              ) : (
                <div className="guide-section-links">
                  <a className="guide-button" href={publicUrl("contracts", language)}>
                    <Icon name="feather" size={17} />
                    {ru ? "Попробовать подписание" : "Try signing"}
                  </a>
                  <a className="guide-button" href={publicUrl("cards", language)}>
                    <Icon name="layers" size={17} />
                    {ru ? "Посмотреть коллекцию" : "Explore collection"}
                  </a>
                </div>
              )}
            </section>
            <section className="guide-faq">
              <h2>{ru ? "Частые вопросы" : "Frequently asked questions"}</h2>
              {data.questions.map((item) => (
                <details key={item.question[1]}>
                  <summary>
                    <span>{copy(item.question)}</span>
                    <Icon name="chevron-down" size={17} />
                  </summary>
                  <p>{copy(item.answer)}</p>
                  {item.support && (
                    <a href={ru ? "/ru/support" : "/en/support"}>{ru ? "Поддержка" : "Support"}</a>
                  )}
                </details>
              ))}
            </section>
          </div>
        </>
      )}
    </section>
  )
}
