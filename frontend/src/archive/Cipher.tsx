import { useEffect, useRef, useState } from "react"
import { request } from "../community/api"
import { useLanguage } from "../i18n"
import type { Round, Wallet } from "./types"

import Regalia from "../regalia/Regalia"
import { CIPHER_ART } from "../regalia/catalog"
const names = {
  ru: ["Компас", "Хамелеон", "Документы", "Сыщики", "Руки", "Часы"],
  en: ["Compass", "Chameleon", "Documents", "Detectives", "Hands", "Hourglass"],
}

export default function Cipher({
  wallet,
  csrf,
  onEarned,
}: {
  wallet: Wallet
  csrf: string
  onEarned: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const [round, setRound] = useState<Round | null>(wallet.round)
  const [choice, setChoice] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const guard = useRef(false)
  useEffect(() => {
    if (wallet.round) setRound(wallet.round)
  }, [wallet.round])
  const act = async (url: string, body?: unknown) => {
    if (guard.current) return
    guard.current = true
    setBusy(true)
    setError("")
    try {
      const data = await request<{ round: Round }>(url, csrf, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      setRound(data.round)
      setChoice([])
      if (data.round.status !== "OPEN") onEarned()
    } catch (reason) {
      setError((reason as Error).message)
      onEarned()
    } finally {
      guard.current = false
      setBusy(false)
    }
  }
  return (
    <section className="archive-cipher">
      <div>
        <small>BUREAU CIPHER / {ru ? "БЕЗ КОМПАНЬОНА" : "BROWSER ACTIVITY"}</small>
        <h2>{ru ? "Раскрой шифр бюро" : "Decode the bureau cipher"}</h2>
        <p>
          {ru
            ? "Четыре разных символа. Шесть попыток. После каждой — число символов на месте и на другой позиции."
            : "Four different symbols. Six attempts. Each guess reveals exact and misplaced matches."}
        </p>
        <p>
          {ru
            ? "За завершение — 30 монет, до пяти заданий в неделю. После шести попыток доступен разбор с той же наградой."
            : "Earn 30 coins, up to five tasks a week. After six guesses a guided solution earns the same reward."}
        </p>
        <p className="archive-help">
          {ru
            ? "Пример: в шифре Компас · Часы · Руки · Документы. Ответ Компас · Руки · Хамелеон · Документы даст 2 на месте и 1 на другой позиции."
            : "Example: Compass · Hourglass · Hands · Documents. Guessing Compass · Hands · Chameleon · Documents gives 2 exact and 1 misplaced."}
        </p>
        <div className="archive-week">
          <b>
            {wallet.completed} / {wallet.weekly_limit}
          </b>
          <span>{ru ? "завершено за неделю" : "completed this week"}</span>
        </div>
        <small>
          {ru ? "Обновление: " : "Resets: "}
          {new Date(wallet.reset_at).toLocaleString(locale)}
        </small>
      </div>
      <div className="archive-cipher-board">
        {error && <p role="alert">{error}</p>}
        {!round || round.status !== "OPEN" ? (
          <>
            {round && (
              <p role="status">
                {ru ? "Шифр разобран. Начислено 30 монет." : "Cipher complete. 30 coins awarded."}
              </p>
            )}
            <div className="archive-cipher-symbols" aria-hidden="true">
              {CIPHER_ART.slice(0, 4).map((id) => (
                <Regalia key={id} id={id} />
              ))}
            </div>
            <button
              className="archive-primary"
              disabled={busy || wallet.completed >= wallet.weekly_limit}
              onClick={() => void act("/api/archive/cipher")}
            >
              {ru ? "Открыть шифр" : "Start cipher"}
            </button>
            {wallet.completed >= wallet.weekly_limit && (
              <p>
                {ru
                  ? "Все пять шифров разобраны. Монеты останутся на счёте."
                  : "All five ciphers are complete. Your coins stay on your account."}
              </p>
            )}
          </>
        ) : (
          <>
            <ol className="archive-guesses" aria-live="polite">
              {round.guesses.map((guess, i) => (
                <li key={i}>
                  <span
                    className="cipher-guess-art"
                    role="img"
                    aria-label={guess.symbols.map((s) => names[language][s]).join(", ")}
                  >
                    {guess.symbols.map((s) => (
                      <Regalia key={s} id={CIPHER_ART[s]} />
                    ))}
                  </span>
                  <small>
                    {guess.exact} {ru ? "на месте" : "exact"} · {guess.misplaced}{" "}
                    {ru ? "иначе" : "misplaced"}
                  </small>
                </li>
              ))}
            </ol>
            {round.solution ? (
              <>
                <p>
                  {ru
                    ? "Разбор: собери эту последовательность и подтверди завершение."
                    : "Solution: use this sequence to complete the task."}
                </p>
                <p>{round.solution.map((s) => names[language][s]).join(" → ")}</p>
                <button
                  className="archive-primary"
                  disabled={busy}
                  onClick={() =>
                    void act(`/api/archive/cipher/${round.id}/guess`, {
                      revision: round.revision,
                      symbols: round.solution,
                    })
                  }
                >
                  {ru ? "Завершить с подсказкой" : "Complete with guidance"}
                </button>
              </>
            ) : (
              <>
                <div className="archive-choice" aria-live="polite">
                  {Array.from({ length: 4 }, (_, i) => (
                    <span key={i}>
                      {choice[i] === undefined ? "·" : names[language][choice[i]]}
                    </span>
                  ))}
                </div>
                <div className="archive-symbol-picker">
                  {CIPHER_ART.map((art, id) => (
                    <button
                      key={id}
                      disabled={busy || choice.includes(id) || choice.length === 4}
                      onClick={() =>
                        setChoice((old) =>
                          old.length < 4 && !old.includes(id) ? [...old, id] : old,
                        )
                      }
                    >
                      <Regalia id={art} />
                      <span>{names[language][id]}</span>
                    </button>
                  ))}
                </div>
                <div className="archive-actions">
                  <button
                    disabled={busy || !choice.length}
                    onClick={() => setChoice((old) => old.slice(0, -1))}
                  >
                    {ru ? "Убрать последний" : "Undo symbol"}
                  </button>
                  <button
                    className="archive-primary"
                    disabled={busy || choice.length !== 4}
                    onClick={() =>
                      void act(`/api/archive/cipher/${round.id}/guess`, {
                        revision: round.revision,
                        symbols: choice,
                      })
                    }
                  >
                    {ru ? "Проверить" : "Check guess"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
