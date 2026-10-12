import { useEffect, useRef, useState } from "react"
import { ApiError, request } from "../community/api"
import type { ArenaReply } from "./types"
type Command = {
  url: string
  method: "POST" | "PUT" | "DELETE"
  body: Record<string, unknown>
  match_id?: string
}
export function useArenaCommand(
  csrf: string,
  accountKey: string,
  onReply: (reply: ArenaReply) => void,
  onConflict: () => void,
) {
  const storageKey = `dc-arena-command:${accountKey}`
  const read = (): Command | null => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "null")
    } catch {
      return null
    }
  }
  const [pending, setPending] = useState<Command | null>(read)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [stateAccount, setStateAccount] = useState(accountKey)
  const active = useRef<AbortController | null>(null)
  const account = useRef(accountKey)
  account.current = accountKey
  useEffect(() => {
    setStateAccount(accountKey)
    setPending(read())
    setError("")
    setBusy(false)
    return () => {
      active.current?.abort()
      active.current = null
    }
  }, [storageKey])
  const save = (command: Command | null) => {
    if (command) sessionStorage.setItem(storageKey, JSON.stringify(command))
    else sessionStorage.removeItem(storageKey)
    setPending(command)
  }
  const run = async (command: Command, recover = false) => {
    if (active.current || !accountKey || stateAccount !== accountKey) return false
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError("")
    const current = () => !controller.signal.aborted && account.current === accountKey
    try {
      const reply = recover
        ? (
            await request<{ result: ArenaReply | null }>(
              `/api/arena/requests/${command.body.request_key}`,
              "",
              { signal: controller.signal },
            )
          ).result
        : await request<ArenaReply>(command.url, csrf, {
            method: command.method,
            body: JSON.stringify(command.body),
            signal: controller.signal,
          })
      if (!current()) return false
      if (!reply) {
        setError(
          "Результат пока не найден. Повторите сохранённый запрос / Result not found yet. Retry the saved request",
        )
        return false
      }
      save(null)
      onReply(reply)
      window.dispatchEvent(new Event("dc-archive-wallet"))
      return true
    } catch (failure) {
      if (!current()) return false
      if (
        !recover &&
        failure instanceof ApiError &&
        [400, 403, 404, 409, 422].includes(failure.status)
      ) {
        save(null)
        onConflict()
      }
      setError((failure as Error).message)
      return false
    } finally {
      if (active.current === controller) {
        active.current = null
        if (current()) setBusy(false)
      }
    }
  }
  return {
    pending: stateAccount === accountKey ? pending : null,
    busy: stateAccount === accountKey && busy,
    error: stateAccount === accountKey ? error : "",
    retry: () => pending && run(pending),
    recover: () => pending && pending.body.request_key && run(pending, true),
    execute: async (
      url: string,
      body: Record<string, unknown>,
      method: Command["method"] = "POST",
    ) => {
      if (active.current || read() || !accountKey || stateAccount !== accountKey) return false
      const command: Command = {
        url,
        method,
        body: method === "PUT" ? body : { ...body, request_key: crypto.randomUUID() },
      }
      const matchID = url.match(/\/matches\/([^/]+)/)?.[1]
      if (matchID) command.match_id = matchID
      try {
        save(command)
      } catch {
        setError("Разрешите хранение данных вкладки / Enable session storage")
        return
      }
      return await run(command)
    },
  }
}
