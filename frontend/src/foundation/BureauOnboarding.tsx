import { useEffect, useState } from "react"
import { useLanguage } from "../i18n"
import Icon from "../icons/Icon"
import { trackFoundationEvent } from "./analytics"
import {
  onboardingPreference,
  onboardingStage,
  saveOnboardingPreference,
  type BureauOnboardingFacts,
  type OnboardingPreference,
} from "./onboarding"
import "../bureau-guide.css"

type GuideSection = "quests" | "active" | "packs" | "profile" | "collection"
type Copy = [ru: string, en: string]

const milestones = {
  mode: {
    title: ["Выбери игровой режим", "Choose a game mode"],
    text: [
      "Открой доску Standard, Ranked или Street Brawl.",
      "Open the Standard, Ranked, or Street Brawl board.",
    ],
    section: "quests",
  },
  sign: {
    title: ["Подпиши первое дело", "Sign your first case"],
    text: [
      "Выбери от одного до трёх заданий и подпиши дело до матча.",
      "Pick one to three objectives and sign your case before playing.",
    ],
    section: "quests",
  },
  result: {
    title: ["Получи подтверждённый результат", "Get a verified result"],
    text: [
      "Сыграй подходящий матч и проверь состояние дела.",
      "Play an eligible match and check the status of your case.",
    ],
    section: "active",
  },
  pack: {
    title: ["Открой ежедневный конверт", "Open the daily pack"],
    text: [
      "Проверь доступность конверта и добавь карточки в коллекцию.",
      "Check pack availability and add cards to your collection.",
    ],
    section: "packs",
  },
  profile: {
    title: ["Познакомься с профилем", "Explore your profile"],
    text: [
      "Посмотри уровень, XP и доступные настройки витрины.",
      "See your level, XP and showcase settings.",
    ],
    section: "profile",
  },
  collection: {
    title: ["Посмотри свою коллекцию", "See your collection"],
    text: [
      "Открой свои карточки и отметь понравившиеся.",
      "See your cards and save your favorites.",
    ],
    section: "collection",
  },
} satisfies Record<string, { title: Copy; text: Copy; section: GuideSection }>

export default function BureauOnboarding({
  accountId,
  csrf,
  facts,
  onNavigate,
  onHelp,
}: {
  accountId: string
  csrf: string
  facts: BureauOnboardingFacts
  onNavigate: (section: GuideSection) => void
  onHelp: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [preference, setPreference] = useState<OnboardingPreference>(() =>
    onboardingPreference(accountId),
  )
  const stage = onboardingStage(facts, preference)
  const step = stage && stage !== "done" ? milestones[stage] : null

  useEffect(() => {
    if (stage === "done" && preference === "started")
      void trackFoundationEvent(accountId, csrf, "onboarding_completed")
  }, [accountId, csrf, preference, stage])

  if (!stage || (stage === "done" && preference === "new")) return null

  const update = (value: OnboardingPreference) => {
    saveOnboardingPreference(accountId, value)
    setPreference(value)
  }

  return (
    <section className="foundation-onboarding" aria-label={ru ? "Первые шаги" : "Getting started"}>
      <Icon name={step ? "book-open" : "circle-check"} size={22} className="onboarding-icon" />
      <div>
        <h2>
          {step ? step.title[ru ? 0 : 1] : ru ? "Первые шаги пройдены" : "Getting started complete"}
        </h2>
        {step && <p>{step.text[ru ? 0 : 1]}</p>}
        <div className="guide-actions">
          {step && (
            <button
              type="button"
              className="guide-button guide-button-primary"
              onClick={() => {
                if (preference === "new") {
                  update("started")
                  void trackFoundationEvent(accountId, csrf, "onboarding_started")
                }
                onNavigate(step.section)
              }}
            >
              {ru ? "Продолжить" : "Continue"}
            </button>
          )}
          <button type="button" className="guide-button" onClick={onHelp}>
            {ru ? "Как это работает" : "How it works"}
          </button>
          <button
            type="button"
            className="guide-button"
            onClick={() => {
              if (stage === "done") update("hidden")
              else if (preference === "started") update("paused")
              else {
                update("skipped")
                void trackFoundationEvent(accountId, csrf, "onboarding_skipped")
              }
            }}
          >
            {stage === "done"
              ? ru
                ? "Скрыть"
                : "Hide"
              : preference === "started"
                ? ru
                  ? "Продолжить позже"
                  : "Continue later"
                : ru
                  ? "Пропустить"
                  : "Skip"}
          </button>
        </div>
      </div>
    </section>
  )
}
