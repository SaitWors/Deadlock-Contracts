import { useId } from "react"
import { useLanguage } from "./i18n"

export type MatchMode = "STANDARD" | "RANKED" | "STREET_BRAWL"
export const MATCH_MODES: MatchMode[] = ["STANDARD", "RANKED", "STREET_BRAWL"]
export const MATCH_MODE_NAMES = {
  STANDARD: "Standard",
  RANKED: "Ranked",
  STREET_BRAWL: "Street Brawl",
}
export default function ModeSelector({
  value,
  onChange,
  statuses,
}: {
  value: MatchMode
  onChange: (value: MatchMode) => void
  statuses: Partial<Record<MatchMode, string>>
}) {
  const { language } = useLanguage()
  const id = useId()
  return (
    <fieldset className="bureau-mode-selector">
      <legend>{language === "ru" ? "Режим матча" : "Match mode"}</legend>
      <label className="bureau-mode-mobile" htmlFor={id}>
        <span>{language === "ru" ? "Выберите режим" : "Choose mode"}</span>
        <select
          id={id}
          aria-label={language === "ru" ? "Режим матча" : "Match mode"}
          value={value}
          onChange={(event) => onChange(event.target.value as MatchMode)}
        >
          {MATCH_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {MATCH_MODE_NAMES[mode]}
            </option>
          ))}
        </select>
        <small role="status">{statuses[value]}</small>
      </label>
      <div className="dc-v3-mode-tabs bureau-mode-desktop">
        {MATCH_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={value === mode ? "active" : ""}
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
          >
            <span>{MATCH_MODE_NAMES[mode]}</span>
            <small>{statuses[mode]}</small>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
