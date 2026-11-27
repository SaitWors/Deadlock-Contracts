import { useState } from "react"
import { ApiError, request, useResource } from "./community/api"
import { LoadState } from "./community/Shared"
import { useLanguage } from "./i18n"

type RelayConnection = {
  id: string
  consented_at: string
  friendship_confirmed_at: string | null
}

type RelayResponse = { connection: RelayConnection | null }
type ReviewAction = "confirm" | "clear" | "disconnect"

export default function ContractRelay({
  csrf,
  userId,
  onDisconnected,
}: {
  csrf: string
  userId?: string
  onDisconnected?: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const url = userId ? `/api/admin/users/${userId}/contract-relay` : "/api/profile/contract-relay"
  const resource = useResource<RelayResponse>(url, { reloadOnLanguageChange: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const connection = resource.data?.connection

  async function update(action: ReviewAction | "join") {
    setBusy(true)
    setError("")
    try {
      const result =
        userId && connection
          ? await request<RelayResponse>(`${url}/${connection.id}`, csrf, {
              method: "PATCH",
              body: JSON.stringify({ action }),
            })
          : await request<RelayResponse>(url, csrf, {
              method: action === "join" ? "PUT" : "DELETE",
            })
      resource.setData(result)
      if (action === "disconnect") onDisconnected?.()
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) resource.reload()
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmed = connection?.friendship_confirmed_at
  const date = (value: string) =>
    new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value))

  return (
    <section className="dc-panel">
      <h3>Contract Relay</h3>
      {error && <p role="alert">{error}</p>}
      {!resource.data ? (
        <LoadState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <p role="status">
            {confirmed
              ? ru
                ? `Дружба подтверждена вручную · ${date(confirmed)}`
                : `Friendship confirmed manually · ${date(confirmed)}`
              : connection
                ? ru
                  ? "Участие включено. Дружба пока не подтверждена."
                  : "Opted in. Friendship is awaiting confirmation."
                : ru
                  ? "Участие выключено."
                  : "Opted out."}
          </p>
          {!userId && (
            <p>
              {ru
                ? "Участие добровольное. Оно разрешает команде сверить дружбу со Steam-профилем Relay для пилота по проверке матчей."
                : "Opt in to let the team check your Steam friendship with Relay for the match verification pilot."}{" "}
              <a href="https://steamcommunity.com/id/deadlock-contracts-relay/">
                {ru ? "Открыть профиль Relay в Steam" : "Open the Relay profile on Steam"}
              </a>
              {connection &&
                (ru
                  ? " Отключение на сайте не удаляет из друзей Steam."
                  : " Disconnecting on this site leaves the Steam friendship in place.")}
            </p>
          )}
          {userId && connection && (
            <p>
              {ru ? "Согласие получено" : "Opted in"} · {date(connection.consented_at)}
            </p>
          )}
          <div className="dc-admin-user-actions">
            {userId && connection && (
              <button
                type="button"
                className="dc-ghost"
                disabled={busy}
                onClick={() => void update(confirmed ? "clear" : "confirm")}
              >
                {confirmed
                  ? ru
                    ? "Снять отметку о дружбе"
                    : "Clear friendship confirmation"
                  : ru
                    ? "Отметить подтверждённую дружбу"
                    : "Mark friendship confirmed"}
              </button>
            )}
            {connection && (
              <button
                type="button"
                className="dc-ghost"
                disabled={busy}
                onClick={() => void update("disconnect")}
              >
                {ru ? "Отключить участие" : "Disconnect"}
              </button>
            )}
            {!connection && !userId && (
              <button
                type="button"
                className="dc-ghost"
                disabled={busy}
                onClick={() => void update("join")}
              >
                {ru ? "Согласен участвовать" : "Opt in"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
