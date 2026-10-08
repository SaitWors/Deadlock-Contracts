import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import ModeSelector, { type MatchMode } from "../ModeSelector"
import SvgIcon from "../icons/Icon"
import { conditionText, localizeServerText, useLanguage, type Language } from "../i18n"
import {
  hasNumber,
  intentCopy,
  metricName,
  progressCopy,
  progressNumber,
  progressText,
  sourceName,
} from "./copy"
import { usePersonalProgress } from "./usePersonalProgress"
import type {
  GoalRecommendation,
  ProgressBoard,
  ProgressDebrief,
  ProgressGoal,
  ProgressHero,
  ProgressIntent,
  ProgressSource,
} from "./types"
import "./personal-progress.css"

type ProgressTab = "goal" | "debrief" | "heroes"
const tabs: ProgressTab[] = ["goal", "debrief", "heroes"]
const intents: ProgressIntent[] = ["PRACTICE", "EXPERIMENT", "RESULT", "VARIETY"]
const activeStates = new Set(["LOCKED", "VERIFYING", "REVIEW_REQUIRED"])
const terminalStates = new Set(["COMPLETED", "FAILED", "EXPIRED", "VOID", "SKIPPED"])

function terminalLabel(status: string, copy: ReturnType<typeof progressCopy>) {
  return (
    (
      {
        COMPLETED: copy.completed,
        FAILED: copy.failed,
        EXPIRED: copy.expired,
        VOID: copy.void,
        SKIPPED: copy.void,
      } as Record<string, string>
    )[status] || copy.finished
  )
}

function SourceBadges({ sources, language }: { sources: ProgressSource[]; language: Language }) {
  const copy = progressCopy(language)
  return (
    <div className="progress-provenance">
      <span className="progress-small-label">{copy.sources}</span>
      <div className="progress-source-list">
        {sources.length ? (
          sources.map((source) => (
            <span className="progress-source" key={source.kind}>
              {sourceName(source.kind, language)} · {progressNumber(source.count, language)}
            </span>
          ))
        ) : (
          <span>{copy.noData}</span>
        )}
      </div>
      {sources.some((source) => source.kind === "CLIENT_ATTESTED_GEP") && (
        <small>{copy.clientData}</small>
      )}
    </div>
  )
}

function GoalCard({
  goal,
  language,
  primary,
  signed,
  terminal = false,
  available,
  onChoose,
  onDebrief,
}: {
  goal: ProgressGoal
  language: Language
  primary?: boolean
  signed: boolean
  terminal?: boolean
  available: boolean
  onChoose: () => void
  onDebrief?: () => void
}) {
  const copy = progressCopy(language)
  const tone = terminal
    ? goal.status === "COMPLETED"
      ? "is-positive"
      : ["FAILED", "EXPIRED"].includes(goal.status)
        ? "is-danger"
        : "is-info"
    : signed
      ? "is-pending"
      : "is-info"
  return (
    <article
      className={`progress-goal ${primary ? "progress-primary-goal" : "progress-alternative"}`}
      data-goal-id={goal.option_id}
    >
      <div className="progress-goal-top">
        <span className={`progress-status ${tone}`}>
          {signed && !terminal ? (
            <SvgIcon name="lock-keyhole" size={15} />
          ) : (
            <SvgIcon name="clipboard-check" size={15} />
          )}
          {terminal
            ? terminalLabel(goal.status, copy)
            : signed
              ? copy.locked
              : primary
                ? copy.recommended
                : copy.alternatives}
        </span>
        {!terminal && (
          <strong className="progress-reward">
            {hasNumber(goal.reward_xp)
              ? `+${progressNumber(goal.reward_xp, language)} XP`
              : copy.noData}
          </strong>
        )}
      </div>
      <h3>{progressText(goal.title_i18n, language)}</h3>
      <p className="progress-goal-description">{progressText(goal.description_i18n, language)}</p>
      <ul className="progress-conditions">
        {goal.conditions.map((condition, index) => (
          <li key={`${condition.metric}-${index}`}>
            {hasNumber(condition.target) ? conditionText(condition, language) : copy.noData}
          </li>
        ))}
      </ul>
      <div className="progress-goal-reason">
        <span className="progress-small-label">
          {goal.personalized ? copy.personal : copy.initial}
        </span>
        <p>{progressText(goal.reason, language)}</p>
        {goal.basis
          .filter((basis) => basis.metric && hasNumber(basis.median))
          .map((basis, index) => (
            <small key={`${basis.metric}-${index}`}>
              {metricName(basis.metric!, language)} · {copy.median.toLowerCase()}:{" "}
              {progressNumber(basis.median, language)}
              {hasNumber(basis.n) || hasNumber(basis.sample_size)
                ? ` · n=${progressNumber(basis.n ?? basis.sample_size, language)}`
                : ""}
            </small>
          ))}
      </div>
      {terminal ? (
        <>
          <p className="progress-goal-description">{copy.terminalHint}</p>
          <button type="button" className="progress-secondary" onClick={onDebrief}>
            {copy.debriefTab}
          </button>
        </>
      ) : signed ? (
        <p className="progress-locked-hint">{copy.lockedHint}</p>
      ) : (
        <button
          type="button"
          className={primary ? "progress-action" : "progress-secondary"}
          disabled={!available}
          onClick={onChoose}
        >
          {copy.choose}
          <SvgIcon name="arrow-up-right" size={17} />
        </button>
      )}
    </article>
  )
}

function Debrief({
  data,
  language,
  onNext,
}: {
  data: ProgressDebrief
  language: Language
  onNext: () => void
}) {
  const copy = progressCopy(language)
  const formatDate = () => {
    if (!data.played_at || !Number.isFinite(Date.parse(data.played_at))) return copy.noData
    return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(data.played_at))
  }
  return (
    <div className="progress-debrief">
      <header className="progress-view-heading">
        <div>
          <span className="progress-small-label">{copy.latest}</span>
          <h3>
            {copy.match} #{data.match_id}
          </h3>
          <p>
            {formatDate()} · {copy.hero} {hasNumber(data.hero_id) ? `#${data.hero_id}` : "—"}
          </p>
        </div>
        <span className="progress-source">{sourceName(data.source, language)}</span>
      </header>
      {data.source === "CLIENT_ATTESTED_GEP" && (
        <p className="progress-data-note">{copy.clientData}</p>
      )}
      <p className="progress-baseline-note">
        {data.baseline_scope === "NONE" || !data.baseline_sample_size ? (
          copy.noBaseline
        ) : (
          <>
            {progressNumber(data.baseline_sample_size, language)} {copy.prior}{" "}
            {data.baseline_scope === "SAME_HERO" ? copy.baselineHero : copy.baselineMode}.
          </>
        )}
      </p>
      {data.comparisons.length ? (
        <div className="progress-table-scroll">
          <table className="progress-comparisons">
            <caption>{copy.comparisonSample}</caption>
            <thead>
              <tr>
                <th scope="col">{language === "ru" ? "Показатель" : "Metric"}</th>
                <th scope="col">{copy.current}</th>
                <th scope="col">{copy.median}</th>
                <th scope="col">{copy.difference}</th>
              </tr>
            </thead>
            <tbody>
              {data.comparisons.map((comparison) => (
                <tr key={comparison.metric} data-metric={comparison.metric}>
                  <th scope="row">{metricName(comparison.metric, language)}</th>
                  <td>{progressNumber(comparison.current, language)}</td>
                  <td>
                    {progressNumber(comparison.median, language)}
                    {hasNumber(comparison.n) &&
                      (comparison.n > 0 || hasNumber(comparison.current)) && (
                        <small className="progress-metric-sample">
                          n={progressNumber(comparison.n, language)}
                        </small>
                      )}
                  </td>
                  <td
                    className={
                      comparison.improved && hasNumber(comparison.delta) ? "is-positive" : ""
                    }
                  >
                    {hasNumber(comparison.delta)
                      ? `${comparison.delta > 0 ? "+" : ""}${progressNumber(comparison.delta, language)}`
                      : copy.noData}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="progress-empty">{copy.noData}</p>
      )}
      <div className="progress-contract-results">
        {data.contracts.length ? (
          data.contracts.map((contract) => {
            const completed = contract.status === "COMPLETED"
            const failed = ["FAILED", "EXPIRED"].includes(contract.status)
            return (
              <article key={contract.assignment_id}>
                <div>
                  <strong>{progressText(contract.title_i18n, language)}</strong>
                  {contract.explanation && (
                    <small>{localizeServerText(contract.explanation, language)}</small>
                  )}
                </div>
                <span
                  className={`progress-status ${completed ? "is-positive" : failed ? "is-danger" : terminalStates.has(contract.status) ? "is-info" : "is-pending"}`}
                >
                  {terminalStates.has(contract.status)
                    ? terminalLabel(contract.status, copy)
                    : copy.pending}
                </span>
                <strong>
                  {hasNumber(contract.reward_granted_xp)
                    ? `+${progressNumber(contract.reward_granted_xp, language)} XP`
                    : copy.noData}
                </strong>
              </article>
            )
          })
        ) : (
          <p>{copy.noContracts}</p>
        )}
      </div>
      <footer className="progress-debrief-footer">
        <div>
          <span className="progress-small-label">{copy.granted}</span>
          <strong>
            {hasNumber(data.xp_granted)
              ? `+${progressNumber(data.xp_granted, language)} XP`
              : copy.noData}
          </strong>
        </div>
        <button type="button" className="progress-action" onClick={onNext}>
          {copy.next}
          <SvgIcon name="arrow-up-right" size={17} />
        </button>
      </footer>
    </div>
  )
}

function HeroDossier({ heroes, language }: { heroes: ProgressHero[]; language: Language }) {
  const copy = progressCopy(language)
  return (
    <div className="progress-heroes">
      <p className="progress-baseline-note">{copy.heroScope}</p>
      {heroes.length ? (
        <div className="progress-hero-grid">
          {heroes.map((hero) => (
            <article className="progress-hero" key={hero.hero_id}>
              <h3>
                {copy.hero} #{hero.hero_id}
              </h3>
              <dl className="progress-hero-counts">
                <div>
                  <dt>{copy.matches}</dt>
                  <dd>{progressNumber(hero.matches, language)}</dd>
                </div>
                <div>
                  <dt>{copy.contracts}</dt>
                  <dd>{progressNumber(hero.contracts_completed, language)}</dd>
                </div>
              </dl>
              <span className="progress-small-label">{copy.records}</span>
              {hero.records.length ? (
                <dl className="progress-records">
                  {hero.records.map((record) => (
                    <div key={record.metric}>
                      <dt>{metricName(record.metric, language)}</dt>
                      <dd>{progressNumber(record.value, language)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>{copy.noData}</p>
              )}
              <SourceBadges sources={hero.sources} language={language} />
            </article>
          ))}
        </div>
      ) : (
        <p className="progress-empty">{copy.noHeroes}</p>
      )}
    </div>
  )
}

export default function PersonalProgress({
  accountId,
  mode,
  currentBoard,
  reloadKey,
  onModeChange,
  onRecommend,
  onRefresh,
  onOpenCase,
  activeCaseCount = 0,
  modeStatuses = {},
}: {
  accountId: string
  mode: MatchMode
  currentBoard: ProgressBoard | null
  reloadKey: string | number
  onModeChange: (mode: MatchMode) => void
  onRecommend: (recommendation: GoalRecommendation) => boolean
  onRefresh: () => Promise<void>
  onOpenCase?: () => void
  activeCaseCount?: number
  modeStatuses?: Partial<Record<MatchMode, string>>
}) {
  const { language } = useLanguage()
  const copy = progressCopy(language)
  const [intent, setIntent] = useState<ProgressIntent>("PRACTICE")
  const [tab, setTab] = useState<ProgressTab>("goal")
  const [selectionChanged, setSelectionChanged] = useState(false)
  const { data, loading, error, retry } = usePersonalProgress({
    accountId,
    mode,
    intent,
    reloadKey,
  })
  const id = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const signed = !!currentBoard && currentBoard.status !== "OFFERED"
  const sameBoard =
    !!data?.board &&
    !!currentBoard &&
    data.board.id === currentBoard.id &&
    data.board.generation === currentBoard.generation &&
    data.board.status === currentBoard.status &&
    currentBoard.game_match_mode === mode
  const canChoose = (goal: ProgressGoal) =>
    sameBoard &&
    !signed &&
    data?.board?.status === "OFFERED" &&
    goal.status === "OFFERED" &&
    currentBoard!.options.some(
      (option) => option.id === goal.option_id && option.status === "OFFERED" && !option.selected,
    )
  const selectedGoalMatches =
    !signed ||
    (!!data?.goal &&
      currentBoard!.options.some((option) => option.id === data.goal!.option_id && option.selected))
  const stale =
    !!data?.board &&
    (!sameBoard || !selectedGoalMatches || (!!data.goal && !signed && !canChoose(data.goal)))

  useEffect(() => setSelectionChanged(false), [data])
  const refresh = () => {
    retry()
    void onRefresh().catch(() => undefined)
  }
  const choose = (goal: ProgressGoal) => {
    if (!canChoose(goal) || !data?.board) {
      setSelectionChanged(true)
      return
    }
    if (
      !onRecommend({
        mode,
        boardId: data.board.id,
        generation: data.board.generation,
        optionId: goal.option_id,
      })
    )
      setSelectionChanged(true)
  }
  const switchTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    setTab(tabs[next])
    tabRefs.current[next]?.focus()
  }
  const tabNames = { goal: copy.goalTab, debrief: copy.debriefTab, heroes: copy.heroesTab }
  return (
    <section className="personal-progress" aria-labelledby={`${id}-heading`}>
      <header className="progress-heading">
        <div>
          <p className="progress-eyebrow">{copy.eyebrow}</p>
          <h2 id={`${id}-heading`}>{copy.title}</h2>
          <p>{copy.intro}</p>
        </div>
        <div className="progress-heading-actions">
          {activeCaseCount > 0 && onOpenCase && (
            <button type="button" className="progress-secondary" onClick={onOpenCase}>
              {language === "ru" ? "Открыть дело" : "Open case"}
            </button>
          )}
          <button
            type="button"
            className="progress-refresh"
            onClick={refresh}
            aria-label={copy.refresh}
          >
            <SvgIcon name="repeat" size={16} />
            <span>{copy.refresh}</span>
          </button>
        </div>
      </header>
      <div className="progress-controls">
        <div
          className="progress-tabs"
          role="tablist"
          aria-label={language === "ru" ? "Личный прогресс" : "Personal progress"}
        >
          {tabs.map((item, index) => (
            <button
              type="button"
              key={item}
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              id={`${id}-tab-${item}`}
              role="tab"
              aria-selected={tab === item}
              aria-controls={`${id}-view-${item}`}
              tabIndex={tab === item ? 0 : -1}
              onClick={() => setTab(item)}
              onKeyDown={(event) => switchTab(event, index)}
            >
              {tabNames[item]}
            </button>
          ))}
        </div>
        <div className="progress-mode-control">
          <ModeSelector value={mode} onChange={onModeChange} statuses={modeStatuses} />
        </div>
      </div>
      <div
        className="progress-view"
        id={`${id}-view-${tab}`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "goal" && (
          <fieldset className="progress-intents" disabled={signed}>
            <legend>{copy.intent}</legend>
            <div>
              {intents.map((value) => (
                <button
                  type="button"
                  key={value}
                  disabled={signed}
                  aria-pressed={intent === value}
                  onClick={() => setIntent(value)}
                >
                  {intentCopy[value][language]}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {loading ? (
          <p className="progress-state" role="status">
            {copy.loading}
          </p>
        ) : error ? (
          <div className="progress-state progress-error" role="alert">
            <p>
              {error === "unauthorized"
                ? copy.unauthorized
                : error === "changed"
                  ? copy.changed
                  : copy.error}
            </p>
            <button type="button" className="progress-secondary" onClick={refresh}>
              {copy.retry}
            </button>
          </div>
        ) : data ? (
          <>
            {tab === "goal" && (
              <>
                <div className="progress-sample">
                  <span>
                    <strong>{progressNumber(data.sample_size, language)}</strong>{" "}
                    {copy.sample.toLowerCase()} · {language === "ru" ? "минимум" : "minimum"}{" "}
                    {progressNumber(data.minimum_sample_size, language)}
                  </span>
                  <p>
                    {data.confidence === "COLD_START"
                      ? copy.coldStart
                      : data.confidence === "LOW"
                        ? copy.preliminary
                        : copy.personal}
                  </p>
                </div>
                {(stale || selectionChanged) && (
                  <div className="progress-changed" role="status">
                    <SvgIcon name="info" size={18} />
                    <p>{copy.changed}</p>
                    <button type="button" className="progress-secondary" onClick={refresh}>
                      {copy.refresh}
                    </button>
                  </div>
                )}
                {data.goal && selectedGoalMatches ? (
                  <div className="progress-goal-layout">
                    <GoalCard
                      goal={data.goal}
                      language={language}
                      primary
                      signed={signed}
                      terminal={
                        signed &&
                        (!activeStates.has(currentBoard!.status) ||
                          !activeStates.has(data.goal.status))
                      }
                      onDebrief={() => setTab("debrief")}
                      available={!stale && canChoose(data.goal)}
                      onChoose={() => choose(data.goal!)}
                    />
                    {!signed && data.alternatives.length > 0 && (
                      <div className="progress-alternatives">
                        {data.alternatives.slice(0, 2).map((goal) => (
                          <GoalCard
                            key={goal.option_id}
                            goal={goal}
                            language={language}
                            signed={false}
                            available={canChoose(goal)}
                            onChoose={() => choose(goal)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="progress-empty">{copy.noGoal}</p>
                )}
                <SourceBadges sources={data.sources} language={language} />
              </>
            )}
            {tab === "debrief" &&
              (data.debrief ? (
                <Debrief
                  data={data.debrief}
                  language={language}
                  onNext={() => {
                    setTab("goal")
                    tabRefs.current[0]?.focus()
                  }}
                />
              ) : (
                <p className="progress-empty">{copy.noDebrief}</p>
              ))}
            {tab === "heroes" && <HeroDossier heroes={data.heroes} language={language} />}
          </>
        ) : null}
      </div>
    </section>
  )
}
