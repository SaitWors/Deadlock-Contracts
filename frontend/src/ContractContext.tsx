import { contractTitle, localizeServerText, type Language } from "./i18n"
import { hasNumber, metricName, progressNumber } from "./progress/copy"

type VerificationBoard = {
  status: string
  provider_status?: {
    phase?: string
    message?: string
    match_id?: string | null
    active_match_ids?: string[]
    delayed_by_provider?: boolean
    queued_count?: number
  } | null
}

// The case status is authoritative. Provider retries and spent attempts do not
// turn an unfinished verification into a failed contract.
export function verificationCopy(board: VerificationBoard, language: Language) {
  const ru = language === "ru"
  if (board.status === "OFFERED") return null
  if (board.status === "SETTLED")
    return {
      title: ru ? "Проверка завершена" : "Verification complete",
      next: ru
        ? "Решения и начисленные награды сохранены в истории дел."
        : "Decisions and granted rewards are saved in your case history.",
    }
  if (board.status === "REVIEW_REQUIRED")
    return {
      title: ru ? "Уточняем данные матча" : "Clarifying match data",
      next: ru
        ? "Данных пока недостаточно для решения. Это не провал: дождитесь результата проверки."
        : "There is not enough data for a decision yet. This is not a failure: await the review result.",
    }
  if (board.status === "VERIFYING")
    return {
      title: ru ? "Проверяем результат матча" : "Verifying the match result",
      next: ru
        ? "Сервер сверяет итоговые данные с условиями дела. Результат и XP появятся после решения."
        : "The server is checking final data against your case. The result and XP follow the decision.",
    }
  if (board.status !== "LOCKED") return null
  if (board.provider_status?.phase === "MATCH_DETECTED")
    return {
      title: ru ? "Матч найден — ждём итоговые данные" : "Match found — awaiting final data",
      next: ru
        ? "Повторно отправлять матч не нужно. Сервер продолжит проверку автоматически."
        : "You do not need to submit the match again. The server will continue checking automatically.",
    }
  if (board.provider_status?.phase === "QUEUED")
    return {
      title: ru ? "Матч сохранён в очереди" : "Match saved in the queue",
      next: ru
        ? "Проверка начнётся после решения по предыдущей попытке. Повторная отправка не нужна."
        : "Checking begins after the previous attempt is resolved. No resubmission is needed.",
    }
  if (board.provider_status?.delayed_by_provider)
    return {
      title: ru ? "Ожидаем данные о матче" : "Awaiting match data",
      next: ru
        ? "Источник данных отвечает с задержкой. Это не провал: поиск продолжится автоматически."
        : "The data source is delayed. This is not a failure: the search continues automatically.",
    }
  return {
    title: ru ? "Ожидаем подходящий матч" : "Awaiting an eligible match",
    next: ru
      ? "Сыграйте матч в выбранном режиме. Если уже сыграли, дождитесь данных: повторно подписывать дело не нужно."
      : "Play a match in this mode. If you already have, await its data; you do not need to sign again.",
  }
}

export function VerificationContext({
  board,
  language,
  pendingReview = false,
}: {
  board: VerificationBoard
  language: Language
  pendingReview?: boolean
}) {
  const copy = verificationCopy(board, language)
  if (!copy) return null
  const provider = board.provider_status
  const matchIds = [...new Set([provider?.match_id, ...(provider?.active_match_ids || [])])].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  return (
    <section
      className="dc-verification-context"
      aria-label={language === "ru" ? "Проверка дела" : "Case verification"}
    >
      <div role="status" aria-atomic="true">
        <h3>{copy.title}</h3>
        <p>{copy.next}</p>
      </div>
      <details className="dc-context-details">
        <summary>{language === "ru" ? "Данные проверки" : "Verification details"}</summary>
        <p>
          {language === "ru"
            ? "Статус получен от сервера. Сигналы Companion предварительны до итогового решения."
            : "Status supplied by the server. Companion signals are provisional until the final decision."}
        </p>
        {matchIds.length > 0 && (
          <p>
            {language === "ru" ? "Матч" : "Match"}: {matchIds.map((id) => `#${id}`).join(", ")}
          </p>
        )}
        {provider?.message && <p>{localizeServerText(provider.message, language)}</p>}
        {hasNumber(provider?.queued_count) && provider.queued_count > 0 && (
          <p>
            {language === "ru" ? "Матчей в очереди" : "Matches queued"}: {provider.queued_count}
          </p>
        )}
        {pendingReview && (
          <p>
            {language === "ru"
              ? "Внутренняя заявка на проверку уже создана. Загружать доказательства не нужно."
              : "An internal review is already open. You do not need to upload evidence."}
          </p>
        )}
      </details>
    </section>
  )
}

type PersonalizationOption = {
  id: string
  title: string
  title_i18n?: Partial<Record<"ru" | "en", string>>
  metric: string
  target: number
  conditions?: Array<{ metric: string; target: number }>
  personalization?: Record<string, unknown>
}
type Basis = { metric: string; n: number; median: number; target: number }

function personalizationFor(option: PersonalizationOption, language: Language) {
  const meta = option.personalization
  if (!meta || !Object.keys(meta).length) return null
  const ru = language === "ru"
  const conditions = option.conditions?.length ? option.conditions : [option]
  const basis: Basis[] =
    meta.enabled === true && Array.isArray(meta.basis)
      ? meta.basis.filter((value): value is Basis => {
          if (!value || typeof value !== "object") return false
          const item = value as Record<string, unknown>
          return (
            typeof item.metric === "string" &&
            hasNumber(item.n) &&
            item.n > 0 &&
            hasNumber(item.median) &&
            hasNumber(item.target) &&
            conditions.some(
              (condition) => condition.metric === item.metric && condition.target === item.target,
            )
          )
        })
      : []
  const sample = hasNumber(meta.sample_size) && meta.sample_size >= 0 ? meta.sample_size : null
  const cold = meta.confidence === "COLD_START" && sample !== null && sample < 5
  let reason = ru ? "Общая цель для этого режима." : "A general goal for this mode."
  if (basis.length) {
    reason = ru
      ? "Условия подобраны с учётом ваших сохранённых результатов в этом режиме."
      : "Conditions use your saved results in this mode."
  } else if (cold) {
    reason =
      sample === 0
        ? ru
          ? "Стартовая цель: при создании доски ещё не было подходящих итоговых матчей."
          : "Starting goal: there were no eligible final matches when this board was created."
        : ru
          ? "Стартовая цель: при создании доски подходящих итоговых матчей было ещё мало."
          : "Starting goal: too few eligible final matches were available when this board was created."
  } else if (meta.kind === "WILDCARD") {
    reason = ru
      ? "Для разнообразия: цель по общим правилам режима."
      : "For variety: a goal using this mode’s general rules."
  }
  return {
    basis,
    sample,
    reason,
    title: option.title_i18n?.[language] || contractTitle(option.title, language),
  }
}

export function PersonalizationContext({
  options,
  language,
}: {
  options: PersonalizationOption[]
  language: Language
}) {
  const entries = options
    .map((option) => ({ id: option.id, ...personalizationFor(option, language) }))
    .filter((item) => item.reason)
  if (!entries.length) return null
  return (
    <details className="dc-personalization-context dc-context-details">
      <summary>
        {language === "ru" ? "Как подобраны контракты" : "How these contracts were chosen"}
      </summary>
      <p>
        {language === "ru"
          ? "Подбор учитывает сохранённые итоговые матчи выбранного режима на момент создания доски. Условия подписанного дела не меняются."
          : "Selection uses saved final matches in this mode at board creation. A signed case keeps its original conditions."}
      </p>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.title}</strong>
            <p>{entry.reason}</p>
            {entry.sample !== null && entry.sample !== undefined && (
              <small>
                {language === "ru" ? "Матчей в выборке" : "Matches in sample"}: {entry.sample}
              </small>
            )}
            {entry.basis?.map((basis) => (
              <small key={basis.metric}>
                {metricName(basis.metric, language)} · {language === "ru" ? "медиана" : "median"}:{" "}
                {progressNumber(basis.median, language)} ·{" "}
                {language === "ru" ? "матчей с показателем" : "matches with this metric"}: {basis.n}{" "}
                · {language === "ru" ? "цель" : "target"}: {progressNumber(basis.target, language)}
              </small>
            ))}
          </li>
        ))}
      </ul>
    </details>
  )
}
