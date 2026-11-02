import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import Icon from "./icons/Icon"
import { useLanguage } from "./i18n"
import {
  APPEARANCE_KEY,
  applyAppearance,
  defaultAppearance,
  normalizeAppearance,
  readAppearance,
  themeModes,
  type Appearance,
} from "./appearance-state"

const Context = createContext({
  appearance: defaultAppearance,
  update: (_patch: Partial<Appearance>) => {},
})
export function useAppearance() {
  return useContext(Context)
}
export function useReducedMotion() {
  const { appearance } = useAppearance()
  const [systemReduced, setSystemReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setSystemReduced(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  return !appearance.motion || systemReduced
}
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(readAppearance)
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches)
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY || event.key === null) setAppearance(readAppearance())
    }
    media.addEventListener("change", onChange)
    window.addEventListener("storage", onStorage)
    return () => {
      media.removeEventListener("change", onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [])
  useLayoutEffect(() => applyAppearance(appearance, dark), [appearance, dark])
  const update = (patch: Partial<Appearance>) =>
    setAppearance((current) => {
      const next = normalizeAppearance({ ...current, ...patch })
      try {
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next))
      } catch {
        /* Tab preferences still work. */
      }
      return next
    })
  return <Context.Provider value={{ appearance, update }}>{children}</Context.Provider>
}

export function AppearanceButton() {
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="ns-theme-trigger"
        aria-label={language === "ru" ? "Настроить оформление" : "Appearance settings"}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="palette" size={19} />
        <span>{language === "ru" ? "Тема" : "Theme"}</span>
      </button>
      {open && <AppearanceDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage(),
    ru = language === "ru"
  const { appearance, update } = useAppearance()
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null)
  const titleId = useId(),
    rangeId = useId(),
    colorId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    const node = dialog.current!
    node.showModal()
    document.body.style.overflow = "hidden"
    heading.current?.focus()
    return () => {
      node.close()
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  const names = ru
    ? {
        system: "Системная",
        light: "Светлая",
        dark: "Тёмная",
        black: "Ультрачёрная",
        custom: "Авторская",
      }
    : { system: "System", light: "Light", dark: "Dark", black: "Ultra black", custom: "Custom" }
  const descriptions = ru
    ? {
        system: "Вслед за устройством",
        light: "Бумага и чернила",
        dark: "Тёмный контракт",
        black: "Глубокий чёрный",
        custom: "Своя палитра",
      }
    : {
        system: "Follow your device",
        light: "Paper and ink",
        dark: "Dark contract",
        black: "Pure black canvas",
        custom: "Your own palette",
      }
  return (
    <dialog
      ref={dialog}
      className="ns-appearance"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialog.current) {
          const r = dialog.current!.getBoundingClientRect()
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose()
        }
      }}
    >
      <header>
        <div>
          <p className="ns-eyebrow">{ru ? "ТВОЯ АТМОСФЕРА" : "YOUR ATMOSPHERE"}</p>
          <h2 ref={heading} tabIndex={-1} id={titleId}>
            {ru ? "Оформление." : "Appearance."}
          </h2>
        </div>
        <button
          type="button"
          className="ns-close"
          onClick={onClose}
          aria-label={ru ? "Закрыть оформление" : "Close appearance"}
        >
          <Icon name="x" />
        </button>
      </header>
      <p className="ns-description">
        {ru ? "Выбери, каким будет твой город сегодня." : "Choose how your city feels today."}
      </p>
      <div className="ns-theme-grid">
        {themeModes.map((mode) => (
          <button
            type="button"
            key={mode}
            data-theme-choice={mode}
            className={`ns-theme-choice ns-sample-${mode}`}
            aria-pressed={appearance.theme === mode}
            onClick={() => update({ theme: mode })}
          >
            <span className="ns-theme-thumbnail" aria-hidden="true">
              <i />
              <b />
              <em />
              <em />
            </span>
            <span className="ns-theme-name">
              {names[mode]}
              {appearance.theme === mode && <Icon name="check" size={16} />}
            </span>
            <small>{descriptions[mode]}</small>
          </button>
        ))}
      </div>
      {appearance.theme === "custom" && (
        <div className="ns-preference-group">
          <label htmlFor={colorId}>{ru ? "Твой акцент" : "Your accent"}</label>
          <div className="ns-accent-controls">
            <input
              id={colorId}
              type="color"
              value={appearance.accent}
              onChange={(e) => update({ accent: e.target.value })}
            />
            <div>
              {["#f2ad73", "#d2ef96", "#91c5ff", "#c5a7ee", "#ee9cae"].map((color) => (
                <button
                  type="button"
                  key={color}
                  style={{ backgroundColor: color }}
                  aria-label={`${ru ? "Акцент" : "Accent"} ${color}`}
                  aria-pressed={appearance.accent === color}
                  onClick={() => update({ accent: color })}
                >
                  {appearance.accent === color && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
            <code>{appearance.accent}</code>
          </div>
        </div>
      )}
      <div className="ns-preference-group">
        <label htmlFor={rangeId}>
          {ru ? "Скругление панелей" : "Panel roundness"}
          <output>{appearance.radius} px</output>
        </label>
        <input
          id={rangeId}
          type="range"
          min="0"
          max="8"
          step="1"
          value={appearance.radius}
          onChange={(e) => update({ radius: Number(e.target.value) })}
        />
        <div className="ns-range-labels">
          <span>{ru ? "Сдержанно" : "Subtle"}</span>
          <span>{ru ? "Мягко" : "Soft"}</span>
        </div>
      </div>
      <label className="ns-motion-control">
        <span>
          <b>{ru ? "Живой интерфейс" : "Interface motion"}</b>
          <small>
            {ru
              ? "Маскот, переходы и реакции на наведение"
              : "Mascot, transitions and hover responses"}
          </small>
        </span>
        <input
          type="checkbox"
          checked={appearance.motion}
          onChange={(e) => update({ motion: e.target.checked })}
        />
      </label>
      <p className="ns-preference-note">
        {ru
          ? "Выбор сохраняется в этом браузере. Системное уменьшение движения имеет приоритет."
          : "Saved in this browser. Your device’s reduced motion setting takes priority."}
      </p>
    </dialog>
  )
}
