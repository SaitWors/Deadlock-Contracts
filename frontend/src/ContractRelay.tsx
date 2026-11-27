import { useState } from "react"
import { ApiError, request, useResource } from "./community/api"
import { LoadState } from "./community/Shared"
import { useLanguage } from "./i18n"

type RelayConnection = {
  id: string
  consented_at: string
  friendship_confirmed_at: string | null
  status?: "pending" | "connected" | "disconnected" | "error" | "unknown"
  friendship_source?: "manual" | "relay_manual" | "steam_web_api" | null
  friendship_observed_at?: string | null
  quick_invite_expires_at?: string | null
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
  const [inviteUrl, setInviteUrl] = useState("")
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

  async function updateInvite(method: "PUT" | "DELETE") {
    if (!connection) return
    setBusy(true)
    setError("")
    try {
      const result = await request<RelayResponse>(`${url}/${connection.id}/quick-invite`, csrf, {
        method,
        body: method === "PUT" ? JSON.stringify({ url: inviteUrl.trim() }) : undefined,
      })
      resource.setData(result)
      setInviteUrl("")
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) resource.reload()
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function openInvite() {
    setBusy(true)
    setError("")
    try {
      const result = await request<{ url: string }>(`${url}/quick-invite`, csrf, { method: "POST" })
      const link = document.createElement("a")
      link.href = result.url
      link.rel = "noreferrer"
      link.referrerPolicy = "no-referrer"
      link.click()
    } catch (reason) {
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

  const reportIsUnknown =
    connection?.status === "pending" &&
    connection.friendship_source === "relay_manual" &&
    connection.friendship_observed_at
  const friendshipStatus = reportIsUnknown
    ? "unknown"
    : (connection?.status ?? (confirmed ? "connected" : "pending"))
  const observed = connection?.friendship_observed_at ?? confirmed
  const canClear = Boolean(confirmed || friendshipStatus === "connected")
  const inviteExpires = connection?.quick_invite_expires_at
  const statusLabels = {
    connected:
      connection?.friendship_source === "steam_web_api"
        ? ru
          ? "Дружба подтверждена через Steam."
          : "Friendship confirmed through Steam."
        : connection?.friendship_source === "relay_manual"
          ? ru
            ? "Дружба подтверждена на узле Relay."
            : "Friendship confirmed on the Relay node."
          : ru
            ? "Дружба подтверждена вручную."
            : "Friendship confirmed manually.",
    pending: ru ? "Дружба ожидает проверки." : "Friendship is awaiting confirmation.",
    disconnected: ru
      ? "Дружба со Steam-профилем Relay не найдена."
      : "Steam friendship with Relay was not found.",
    error: ru ? "Relay не удалось проверить дружбу." : "Relay could not verify the friendship.",
    unknown: ru ? "Состояние дружбы неизвестно." : "Friendship status is unknown.",
  }
  const statusText = connection
    ? (statusLabels[friendshipStatus] ?? statusLabels.unknown)
    : ru
      ? "Участие выключено."
      : "Opted out."

  return (
    <section className="dc-panel">
      <h3>Contract Relay</h3>
      {error && <p role="alert">{error}</p>}
      {!resource.data ? (
        <LoadState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <p role="status">
            {statusText}
            {observed && (
              <>
                {" · "}
                <time dateTime={observed}>{date(observed)}</time>
              </>
            )}
          </p>
          {!userId && (
            <p>
              {ru
                ? "Участие добровольное. Оно разрешает команде сверить дружбу со Steam-профилем Relay для пилота по проверке матчей. В пилоте 30 мест."
                : "Opt in to let the team check your Steam friendship with Relay for the match verification pilot. The pilot has 30 places."}{" "}
              <a href="https://steamcommunity.com/id/deadlock-contracts-relay/">
                {ru ? "Открыть профиль Relay в Steam" : "Open the Relay profile on Steam"}
              </a>
              {connection &&
                (ru
                  ? " Отключение на сайте не удаляет из друзей Steam."
                  : " Disconnecting on this site leaves the Steam friendship in place.")}
            </p>
          )}
          {!userId && inviteExpires && (
            <p>
              <button
                type="button"
                className="dc-ghost"
                disabled={busy}
                onClick={() => void openInvite()}
              >
                {ru ? "Открыть Quick Invite в Steam" : "Open Quick Invite in Steam"}
              </button>{" "}
              {ru ? "Доступно до" : "Available until"}{" "}
              <time dateTime={inviteExpires}>{date(inviteExpires)}</time>
            </p>
          )}
          {userId && connection && (
            <>
              <p>
                {ru ? "Согласие получено" : "Opted in"} · {date(connection.consented_at)}
              </p>
              <p>
                {ru ? "ID согласия" : "Consent ID"}{" "}
                <code className="dc-relay-consent-id">{connection.id}</code>
              </p>
              {inviteExpires && (
                <p>
                  {ru
                    ? "Quick Invite доступен игроку до"
                    : "Quick Invite available to the player until"}{" "}
                  <time dateTime={inviteExpires}>{date(inviteExpires)}</time>
                </p>
              )}
              {friendshipStatus !== "connected" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void updateInvite("PUT")
                  }}
                >
                  <label>
                    {ru ? "Новая ссылка Quick Invite из Steam" : "New Steam Quick Invite link"}{" "}
                    <input
                      type="password"
                      value={inviteUrl}
                      onChange={(event) => setInviteUrl(event.target.value)}
                      autoComplete="off"
                      maxLength={128}
                      required
                      disabled={busy}
                    />
                  </label>{" "}
                  <button type="submit" className="dc-ghost" disabled={busy || !inviteUrl.trim()}>
                    {ru ? "Показать игроку" : "Share with player"}
                  </button>
                </form>
              )}
              {inviteExpires && (
                <button
                  type="button"
                  className="dc-ghost"
                  disabled={busy}
                  onClick={() => void updateInvite("DELETE")}
                >
                  {ru ? "Отозвать Quick Invite на сайте" : "Revoke Quick Invite on this site"}
                </button>
              )}
            </>
          )}
          <div className="dc-admin-user-actions">
            {userId && connection && (
              <button
                type="button"
                className="dc-ghost"
                disabled={busy}
                onClick={() => void update(canClear ? "clear" : "confirm")}
              >
                {canClear
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
