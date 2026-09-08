import { useEffect, useId, useRef, useState } from "react"
import { useLanguage } from "./i18n"
import Regalia from "./regalia/Regalia"

export const guideKey = (account: string) => `dc.bureau.guide.v1.${account}`
export function hasSeenGuide(account: string) {
  try {
    return window.localStorage.getItem(guideKey(account)) === "seen"
  } catch {
    return false
  }
}
export function rememberGuide(account: string) {
  try {
    window.localStorage.setItem(guideKey(account), "seen")
  } catch {
    /* Browsing still works with storage disabled. */
  }
}

export default function BureauGuide({
  onClose,
  onNavigate,
}: {
  onClose: () => void
  onNavigate: (tab: "quests" | "archive" | "bureaus") => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [step, setStep] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const textId = useId()
  const steps = ru
    ? [
        {
          title: "Ваш матч. Новое дело.",
          text: "Контракт — дополнительная цель в Deadlock. За выполненные условия бюро выдаёт XP, уровни и достижения. Они видны в профиле и рейтинге сайта.",
          detail:
            "Откройте «Контракты», выберите режим матча и до трёх условий из шести. Прочитайте договор и поставьте печать до игры.",
          note: "После подписания выбор зафиксирован. На дело — 24 часа и до трёх подходящих матчей. Прогресс разных матчей не складывается.",
          action: "Выбрать контракт",
        },
        {
          title: "Есть дело и без игры.",
          text: "Пока компаньон проходит QA, в браузере уже можно разбирать шифры и собирать карточки героев.",
          detail:
            "Разберите шифр → получите жетоны архива → выберите карточку в каталоге или откройте конверт. До покупки видны цена, состав и шансы.",
          note: "Жетоны и XP — разные вещи. Жетоны нужны для карточек, XP отражает выполненные контракты. Шифры работают без компаньёна.",
          action: "Разобрать первый шифр",
        },
        {
          title: "Оставьте свой след.",
          text: "Выберите медаль и до трёх карточек для витрины, настройте профиль и найдите своих людей в бюро игроков.",
          detail:
            "У каждого достижения есть условия и прогресс. Совместные операции дают цель всей команде. Своё место в рейтинге можно посмотреть, оставаясь в аккаунте.",
          note: "Матчевые награды появляются после проверки результата. Если проверка задержалась, откройте «Дело». Для начала можно просто осмотреться.",
          action: "Найти бюро",
        },
      ]
    : [
        {
          title: "Your match. A new case.",
          text: "A contract is an extra objective in Deadlock. Verified objectives earn XP, levels and achievements for your profile and the site's leaderboard.",
          detail:
            "Open Contracts, choose your match mode and up to three of six objectives. Read the document and seal it before playing.",
          note: "Signing locks your selection. A case lasts 24 hours and allows up to three eligible matches. Progress does not add up across matches.",
          action: "Choose a contract",
        },
        {
          title: "A case without a match.",
          text: "While the Companion is in QA, you can already solve ciphers and collect hero cards in your browser.",
          detail:
            "Solve a cipher → earn archive tokens → choose a card from the catalogue or open an envelope. Price, contents and odds are shown before purchase.",
          note: "Tokens and XP are separate. Tokens are for cards; XP reflects completed contracts. Ciphers work without the Companion.",
          action: "Solve your first cipher",
        },
        {
          title: "Leave your mark.",
          text: "Feature a medal and up to three cards, personalise your profile, and find your people in a player bureau.",
          detail:
            "Every achievement has conditions and progress. Joint operations give your team a shared goal. Check your rank without signing out.",
          note: "Match rewards arrive after verification. If verification is delayed, open Case. You can start by simply exploring.",
          action: "Find a bureau",
        },
      ]
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement as HTMLElement | null
    element.showModal()
    return () => {
      element.close()
      if (trigger?.isConnected && !trigger.matches(":disabled")) trigger.focus()
    }
  }, [])
  useEffect(() => {
    heading.current?.focus()
    dialog.current?.scrollTo?.({ top: 0 })
  }, [step])
  const current = steps[step]
  return (
    <dialog
      ref={dialog}
      className="bureau-guide"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header className="bureau-guide-top">
        <span>{ru ? "ПАМЯТКА ОПЕРАТИВНИКА" : "OPERATIVE BRIEFING"}</span>
        <button onClick={onClose} aria-label={ru ? "Закрыть вступление" : "Close introduction"}>
          ×
        </button>
      </header>
      <div
        className="bureau-guide-pages"
        aria-label={ru ? "Страницы вступления" : "Introduction pages"}
      >
        {steps.map((item, i) => (
          <button
            key={i}
            onClick={() => setStep(i)}
            aria-current={i === step ? "step" : undefined}
            aria-label={`${i + 1}. ${item.title}`}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="bureau-guide-content">
        <Regalia id={(["medal-first", "seal-archive", "seal-team"] as const)[step]} />
        <p className="bureau-guide-index">
          {ru ? "ЛИСТ" : "PAGE"} 0{step + 1} / 03
        </p>
        <h2 ref={heading} tabIndex={-1} id={titleId}>
          {current.title}
        </h2>
        <p id={textId}>{current.text}</p>
        <div className="bureau-guide-note">
          <p>{current.detail}</p>
          <small>{current.note}</small>
        </div>
        <button
          className="bureau-action bureau-action-secondary"
          onClick={() => onNavigate((["quests", "archive", "bureaus"] as const)[step])}
        >
          {current.action} ↗
        </button>
      </div>
      <footer className="bureau-guide-footer">
        <button
          className="bureau-action bureau-action-secondary"
          onClick={step ? () => setStep(step - 1) : onClose}
        >
          {step ? (ru ? "Назад" : "Back") : ru ? "Осмотрюсь сам" : "Explore myself"}
        </button>
        <button className="bureau-action" onClick={step < 2 ? () => setStep(step + 1) : onClose}>
          {step < 2 ? (ru ? "Дальше →" : "Next →") : ru ? "Открыть бюро" : "Enter the bureau"}
        </button>
      </footer>
    </dialog>
  )
}
