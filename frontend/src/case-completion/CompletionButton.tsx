import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import SvgIcon from "../icons/Icon"
import { useLanguage } from "../i18n"
import "./completion-button.css"

type CompletionCase = {
  status: string
  attempts_used: number
  max_attempts: number
  options?: { selected: boolean; status: string }[]
  items?: { status: string }[]
}

export function canShowCompletion(value: CompletionCase): boolean {
  if (value.status !== "SETTLED") return false
  const tasks = value.options?.filter((option) => option.selected) ?? value.items ?? []
  if (tasks.length < 1 || tasks.length > 3) return false
  if (tasks.every((task) => task.status === "COMPLETED")) return true
  return (
    Number.isInteger(value.max_attempts) &&
    value.max_attempts > 0 &&
    value.attempts_used >= value.max_attempts &&
    tasks.every((task) => ["COMPLETED", "FAILED", "VOID", "EXPIRED"].includes(task.status))
  )
}

type CompletionProps = { boardId: string; onClose: () => void }
type CompletionContextValue = {
  show: (boardId: string) => Promise<void>
  busy: boolean
  openingBoard: string | null
  openBoard: string | null
  errorBoard: string | null
  errorId: string
  viewed: ReadonlySet<string>
}
const CompletionContext = createContext<CompletionContextValue | null>(null)

export function CompletionProvider({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [Scene, setScene] = useState<ComponentType<CompletionProps> | null>(null)
  const [openBoard, setOpenBoard] = useState<string | null>(null)
  const [openingBoard, setOpeningBoard] = useState<string | null>(null)
  const [errorBoard, setErrorBoard] = useState<string | null>(null)
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set())
  const pending = useRef(false)
  const mounted = useRef(true)
  const errorId = useId()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const show = async (boardId: string) => {
    if (pending.current) return
    pending.current = true
    setErrorBoard(null)
    if (Scene) {
      setOpenBoard(boardId)
      return
    }
    setOpeningBoard(boardId)
    try {
      const module = await import("./CaseCompletion")
      if (!mounted.current) return
      setScene(() => module.default)
      setOpenBoard(boardId)
    } catch {
      pending.current = false
      if (mounted.current) setErrorBoard(boardId)
    } finally {
      if (mounted.current) setOpeningBoard(null)
    }
  }

  return (
    <CompletionContext.Provider
      value={{
        show,
        busy: openingBoard !== null || openBoard !== null,
        openingBoard,
        openBoard,
        errorBoard,
        errorId,
        viewed,
      }}
    >
      <div className={className}>
        {children}
        {openingBoard && (
          <div className="case-completion-notice" role="status">
            {ru ? "Открываем итог…" : "Opening result…"}
          </div>
        )}
        {errorBoard && (
          <div className="case-completion-notice" id={errorId} role="alert">
            <p>
              {ru
                ? "Не удалось открыть итог. Попробуйте снова."
                : "The result could not be opened. Please retry."}
            </p>
            <button type="button" onClick={() => void show(errorBoard)}>
              {ru ? "Повторить" : "Retry"}
            </button>
            <button type="button" onClick={() => setErrorBoard(null)}>
              {ru ? "Закрыть" : "Close"}
            </button>
          </div>
        )}
        {openBoard && Scene && (
          <Scene
            boardId={openBoard}
            onClose={() => {
              pending.current = false
              setOpenBoard(null)
              setViewed((previous) => new Set(previous).add(openBoard))
            }}
          />
        )}
      </div>
    </CompletionContext.Provider>
  )
}

export default function CompletionButton({ boardId }: { boardId: string }) {
  const context = useContext(CompletionContext)
  const { language } = useLanguage()
  if (!context) throw new Error("CompletionButton requires CompletionProvider")
  const ru = language === "ru"
  const viewed = context.viewed.has(boardId)
  return (
    <div className="case-completion-entry">
      <button
        className="case-completion-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-busy={context.openingBoard === boardId || context.openBoard === boardId}
        aria-describedby={context.errorBoard === boardId ? context.errorId : undefined}
        disabled={context.busy}
        onClick={() => void context.show(boardId)}
      >
        <SvgIcon name={viewed ? "repeat" : "circle-check"} size={18} />
        {viewed
          ? ru
            ? "Повторить итог"
            : "Replay result"
          : ru
            ? "Завершить контракт"
            : "Finish contract"}
      </button>
    </div>
  )
}
