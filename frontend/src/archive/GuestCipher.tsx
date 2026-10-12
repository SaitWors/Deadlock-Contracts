import { useState } from "react"
import { useLanguage } from "../i18n"
import Regalia from "../regalia/Regalia"
import { CIPHER_ART } from "../regalia/catalog"
import "./first-visit.css"
import "./nightshift-archive.css"

const SOLUTION = [0, 5, 4, 2]
const SYMBOLS = {
  ru: ["Компас", "Хамелеон", "Документы", "Сыщики", "Руки", "Часы"],
  en: ["Compass", "Chameleon", "Documents", "Detectives", "Hands", "Hourglass"],
}

type Guess = { symbols: number[]; exact: number; misplaced: number }
type Outcome = "playing" | "exhausted" | "solved" | "assisted"

function score(symbols: number[]) {
  const exact = symbols.filter((symbol, index) => SOLUTION[index] === symbol).length
  const misplaced = symbols.filter(
    (symbol, index) => SOLUTION[index] !== symbol && SOLUTION.includes(symbol),
  ).length
  return { exact, misplaced }
}

export default function GuestCipher({ onHome }: { onHome: () => void }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const names = SYMBOLS[language]
  const [choice, setChoice] = useState<number[]>([])
  const [guesses, setGuesses] = useState<Guess[]>([])
  const [outcome, setOutcome] = useState<Outcome>("playing")
  const [announcement, setAnnouncement] = useState("")

  const choose = (symbol: number) => {
    if (outcome !== "playing" || choice.includes(symbol) || choice.length >= 4) return
    setChoice((current) => [...current, symbol])
  }
  const submit = () => {
    if (choice.length !== 4 || outcome !== "playing") return
    const result = score(choice)
    const nextGuesses = [...guesses, { symbols: choice, ...result }]
    setGuesses(nextGuesses)
    setChoice([])
    if (result.exact === 4) {
      setOutcome("solved")
      setAnnouncement(ru ? "Шифр раскрыт." : "Cipher solved.")
    } else if (nextGuesses.length === 6) {
      setOutcome("exhausted")
      setAnnouncement(
        ru
          ? "Шесть попыток закончились. Откройте разбор."
          : "All six attempts are used. Open the explanation.",
      )
    } else {
      setAnnouncement(
        ru
          ? `${result.exact} на месте · ${result.misplaced} не на месте`
          : `${result.exact} exact · ${result.misplaced} misplaced`,
      )
    }
  }
  const explain = () => {
    setOutcome("assisted")
    setAnnouncement(ru ? "Разбор открыт." : "Explanation opened.")
  }
  const reset = () => {
    setChoice([])
    setGuesses([])
    setOutcome("playing")
    setAnnouncement("")
  }
  const revealed = outcome === "solved" || outcome === "assisted"

  return (
    <main className="guest-cipher">
      <header className="guest-cipher-header">
        <button type="button" className="guest-home" onClick={onHome}>
          ← {ru ? "Вернуться на главную" : "Return home"}
        </button>
        <span>{ru ? "ДЕМО БЕЗ ВХОДА" : "NO-SIGN-IN DEMO"}</span>
      </header>
      <div className="guest-cipher-layout">
        <section className="guest-cipher-board" aria-labelledby="guest-cipher-title">
          <p className="guest-eyebrow">BUREAU ARCHIVE / TRAINING FILE</p>
          <h1 id="guest-cipher-title">{ru ? "Учебный шифр" : "Teaching cipher"}</h1>
          <p className="guest-lead">
            {ru
              ? "Выберите четыре разных символа. У вас шесть попыток; после каждой мы покажем совпадения на месте и на другой позиции."
              : "Choose four different symbols. You have six attempts; each result shows exact and misplaced matches."}
          </p>
          <p className="guest-demo-note">
            {ru
              ? "Это учебный пример: монеты не начисляются, а результат не переносится в аккаунт."
              : "This is a teaching demo: it awards no coins and does not transfer progress to an account."}
          </p>

          <ol className="guest-choice" aria-label={ru ? "Выбранные символы" : "Chosen symbols"}>
            {[0, 1, 2, 3].map((slot) => {
              const symbol = choice[slot]
              return (
                <li key={slot}>
                  {symbol === undefined ? (
                    <span aria-hidden="true">{slot + 1}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setChoice((current) => current.filter((_, i) => i !== slot))}
                      aria-label={ru ? `Убрать ${names[symbol]}` : `Remove ${names[symbol]}`}
                    >
                      <Regalia id={CIPHER_ART[symbol]} />
                      <span>{names[symbol]}</span>
                    </button>
                  )}
                </li>
              )
            })}
          </ol>

          <div className="guest-symbol-picker" aria-label={ru ? "Символы" : "Symbols"}>
            {CIPHER_ART.map((id, symbol) => (
              <button
                key={id}
                type="button"
                disabled={outcome !== "playing" || choice.includes(symbol) || choice.length >= 4}
                aria-pressed={choice.includes(symbol)}
                onClick={() => choose(symbol)}
              >
                <Regalia id={id} />
                <span>{names[symbol]}</span>
              </button>
            ))}
          </div>

          <div className="guest-actions">
            <button
              type="button"
              className="bureau-action"
              disabled={choice.length !== 4 || outcome !== "playing"}
              onClick={submit}
            >
              {ru ? "Проверить" : "Check guess"}
            </button>
            {!revealed && (
              <button
                type="button"
                className="bureau-action bureau-action-secondary"
                onClick={explain}
              >
                {ru ? "Показать разбор" : "Show explanation"}
              </button>
            )}
            <button type="button" className="guest-reset" onClick={reset}>
              {ru ? "Начать заново" : "Start over"}
            </button>
          </div>
          <p className="guest-result" aria-live="polite">
            {announcement || (ru ? "Соберите первую комбинацию." : "Build your first guess.")}
          </p>
        </section>

        <aside className="guest-cipher-record">
          <div>
            <span>{guesses.length} / 6</span>
            <h2>{ru ? "История попыток" : "Guess history"}</h2>
          </div>
          {guesses.length ? (
            <ol className="guest-history">
              {guesses.map((guess, index) => (
                <li key={index}>
                  <strong>{ru ? `Попытка ${index + 1}` : `Guess ${index + 1}`}</strong>
                  <span>{guess.symbols.map((symbol) => names[symbol]).join(" · ")}</span>
                  <small>
                    {ru
                      ? `${guess.exact} на месте · ${guess.misplaced} не на месте`
                      : `${guess.exact} exact · ${guess.misplaced} misplaced`}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p>{ru ? "Здесь появятся результаты." : "Your results will appear here."}</p>
          )}
          {revealed && (
            <div className="guest-solution">
              <span>{outcome === "solved" ? (ru ? "ДЕЛО ЗАКРЫТО" : "CASE CLOSED") : "GUIDED"}</span>
              <h2>{ru ? "Решение" : "Solution"}</h2>
              <p>{SOLUTION.map((symbol) => names[symbol]).join(" → ")}</p>
              <p>
                {ru
                  ? "Это было демо: монеты не начислены и прогресс не перенесён."
                  : "This was a demo: no coins were awarded and no progress was transferred."}
              </p>
              <a className="bureau-action" href="/auth/steam">
                {ru ? "Продолжить через Steam" : "Continue with Steam"}
              </a>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
