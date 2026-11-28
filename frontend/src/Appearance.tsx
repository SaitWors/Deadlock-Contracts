import {
  createContext,
  Fragment,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import Icon from "./icons/Icon"
import { useBannerAccount } from "./foundation/banner"
import { useLanguage } from "./i18n"
import {
  APPEARANCE_KEY,
  SYSTEM_MOTION_QUERY,
  SYSTEM_THEME_QUERY,
  applyAppearance,
  defaultAppearance,
  normalizeAppearance,
  readAppearance,
  resolveReducedMotion,
  themeModes,
  type Appearance,
  type EffectsQuality,
} from "./appearance-state"

const Context = createContext({
  appearance: defaultAppearance,
  update: (_patch: Partial<Appearance>) => {},
  reducedMotion: undefined as boolean | undefined,
  effectsQuality: undefined as Exclude<EffectsQuality, "AUTO"> | undefined,
})
const COARSE_POINTER_QUERY = "(pointer: coarse)"
const BannerPreferences = lazy(() => import("./foundation/BannerPreferences"))

function useMediaMatches(query: string, enabled = true) {
  const [matches, setMatches] = useState(() => enabled && window.matchMedia(query).matches)
  useEffect(() => {
    if (!enabled) return
    const media = window.matchMedia(query)
    const readMatch = () => setMatches(media.matches)
    readMatch()
    media.addEventListener("change", readMatch)
    return () => media.removeEventListener("change", readMatch)
  }, [query, enabled])
  return matches
}

function resolveEffectsQuality(quality: EffectsQuality, coarsePointer: boolean) {
  if (quality !== "AUTO") return quality
  const cores = navigator.hardwareConcurrency
  return coarsePointer || (cores > 0 && cores <= 4) ? "LITE" : "FULL"
}

export function useAppearance() {
  return useContext(Context)
}

export function useReducedMotion() {
  const { reducedMotion } = useAppearance()
  const systemReduced = useMediaMatches(SYSTEM_MOTION_QUERY, reducedMotion === undefined)
  return reducedMotion ?? systemReduced
}

export function useEffectsQuality() {
  const { effectsQuality } = useAppearance()
  const coarsePointer = useMediaMatches(COARSE_POINTER_QUERY, effectsQuality === undefined)
  return effectsQuality ?? resolveEffectsQuality("AUTO", coarsePointer)
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(readAppearance)
  const dark = useMediaMatches(SYSTEM_THEME_QUERY)
  const systemReduced = useMediaMatches(SYSTEM_MOTION_QUERY)
  const coarsePointer = useMediaMatches(COARSE_POINTER_QUERY)
  const reducedMotion = resolveReducedMotion(appearance.motion, systemReduced)
  const effectsQuality = resolveEffectsQuality(appearance.effectsQuality, coarsePointer)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY || event.key === null) setAppearance(readAppearance())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])
  useLayoutEffect(
    () => applyAppearance(appearance, dark, reducedMotion),
    [appearance, dark, reducedMotion],
  )
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
  return (
    <Context.Provider value={{ appearance, update, reducedMotion, effectsQuality }}>
      {children}
    </Context.Provider>
  )
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

// Each theme pairs its label and description in English and Russian.
const themeCopy = {
  system: [
    ["System", "Follow your device"],
    ["Системная", "Вслед за устройством"],
  ],
  light: [
    ["Light", "Paper and ink"],
    ["Светлая", "Бумага и чернила"],
  ],
  dark: [
    ["Dark", "Dark contract"],
    ["Тёмная", "Тёмный контракт"],
  ],
  black: [
    ["Ultra black", "Pure black canvas"],
    ["Ультрачёрная", "Глубокий чёрный"],
  ],
  custom: [
    ["Custom", "Your own palette"],
    ["Авторская", "Своя палитра"],
  ],
}

const motionFields = [
  {
    field: "motion",
    label: ["Motion", "Анимации"],
    options: [
      ["SYSTEM", "Follow your device", "Как на устройстве"],
      ["FULL", "Full motion", "Полные анимации"],
      ["OFF", "Off", "Выключены"],
    ],
  },
  {
    field: "effectsQuality",
    label: ["Effects quality", "Качество эффектов"],
    options: [
      ["AUTO", "Auto", "Авто"],
      ["FULL", "Full", "Полное"],
      ["LITE", "Lite", "Упрощённое"],
    ],
  },
] as const

function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage(),
    ru = language === "ru"
  const languageIndex = ru ? 1 : 0
  const { appearance, update } = useAppearance()
  const bannerAccount = useBannerAccount()
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null)
  const titleId = useId(),
    rangeId = useId(),
    colorId = useId(),
    preferencesId = useId()
  const motionHintId = `${preferencesId}-hint`
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
        if (event.target !== event.currentTarget) return
        const { clientX, clientY } = event
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect()
        if (clientX < left || clientX > right || clientY < top || clientY > bottom) onClose()
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
        {themeModes.map((mode) => {
          const [name, description] = themeCopy[mode][languageIndex]
          const selected = appearance.theme === mode
          return (
            <button
              type="button"
              key={mode}
              data-theme-choice={mode}
              className={`ns-theme-choice ns-sample-${mode}`}
              aria-pressed={selected}
              onClick={() => update({ theme: mode })}
            >
              <span className="ns-theme-thumbnail" aria-hidden="true">
                <i />
                <b />
                <em />
                <em />
              </span>
              <span className="ns-theme-name">
                {name}
                {selected && <Icon name="check" size={16} />}
              </span>
              <small>{description}</small>
            </button>
          )
        })}
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
      <div className="ns-preference-group">
        {motionFields.map(({ field, label, options }) => {
          const id = `${preferencesId}-${field}`
          const hasMotionHint = field === "motion"
          return (
            <Fragment key={field}>
              <label htmlFor={id}>{label[languageIndex]}</label>
              <select
                id={id}
                className="ns-preference-select"
                aria-describedby={hasMotionHint ? motionHintId : undefined}
                value={appearance[field]}
                onChange={(event) => update({ [field]: event.target.value })}
              >
                {options.map(([mode, english, russian]) => (
                  <option key={mode} value={mode}>
                    {ru ? russian : english}
                  </option>
                ))}
              </select>
              {hasMotionHint && (
                <p id={motionHintId} className="ns-preference-note">
                  {ru
                    ? "Полные анимации могут включать яркие вспышки и интенсивное движение."
                    : "Full motion may include bright flashes and intense movement."}
                </p>
              )}
            </Fragment>
          )
        })}
      </div>
      <label className="ns-motion-control">
        <span>
          <b>{ru ? "Звуки открытия паков" : "Pack opening sounds"}</b>
        </span>
        <input
          type="checkbox"
          checked={appearance.packSound}
          onChange={(e) => update({ packSound: e.target.checked })}
        />
      </label>
      {bannerAccount && (
        <Suspense fallback={null}>
          <BannerPreferences key={bannerAccount.id} account={bannerAccount} ru={ru} />
        </Suspense>
      )}
    </dialog>
  )
}
