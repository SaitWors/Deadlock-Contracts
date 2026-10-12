import { useEffect, useRef, useState } from "react"
import { request } from "../community/api"
import { useLanguage } from "../i18n"
import Icon from "../icons/Icon"
import type { EconomyScope } from "./types"

export type FavoriteControls = {
  ids: string[] | null
  revision: number
  loading: boolean
  pendingId: string | null
  error: string
  reload: () => void
  setFavorite: (id: string, favorite: boolean) => Promise<boolean>
}

export function useFavorites(
  csrf: string,
  accountKey: string,
  scope: EconomyScope = "REAL",
): FavoriteControls {
  const identity = `${accountKey}:${scope}`
  const [state, setState] = useState({
    account: "",
    ids: null as string[] | null,
    loading: true,
    pendingId: null as string | null,
    error: "",
  })
  const [revision, setRevision] = useState(0)
  const [mutationRevision, setMutationRevision] = useState(0)
  const currentAccount = useRef(identity)
  currentAccount.current = identity
  const generation = useRef(0)
  const write = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const epoch = ++generation.current
    write.current?.abort()
    write.current = null
    setState({ account: identity, ids: null, loading: true, pendingId: null, error: "" })
    if (accountKey) {
      request<{ card_ids: string[] }>(`/api/archive/favorites?scope=${scope}`, "", {
        signal: controller.signal,
      })
        .then((data) => {
          if (
            !controller.signal.aborted &&
            epoch === generation.current &&
            identity === currentAccount.current
          )
            setState({
              account: identity,
              ids: data.card_ids,
              loading: false,
              pendingId: null,
              error: "",
            })
        })
        .catch((reason) => {
          if (
            !controller.signal.aborted &&
            epoch === generation.current &&
            identity === currentAccount.current
          )
            setState({
              account: identity,
              ids: null,
              loading: false,
              pendingId: null,
              error: (reason as Error).message,
            })
        })
    }
    return () => {
      ++generation.current
      controller.abort()
      write.current?.abort()
      write.current = null
    }
  }, [identity, revision])
  const setFavorite = async (id: string, favorite: boolean) => {
    if (
      !accountKey ||
      currentAccount.current !== identity ||
      state.account !== identity ||
      !state.ids ||
      state.loading ||
      write.current
    )
      return false
    if (state.ids.includes(id) === favorite) return true
    const epoch = generation.current
    const controller = new AbortController()
    write.current = controller
    setState((old) => ({ ...old, pendingId: id, error: "" }))
    try {
      const result = await request<{ card_id: string; favorite: boolean }>(
        `/api/archive/favorites/${encodeURIComponent(id)}`,
        csrf,
        {
          method: "PUT",
          body: JSON.stringify({ favorite, scope }),
          signal: controller.signal,
        },
      )
      if (
        controller.signal.aborted ||
        epoch !== generation.current ||
        identity !== currentAccount.current
      )
        return false
      setState((old) => ({
        ...old,
        ids: result.favorite
          ? [...new Set([...(old.ids || []), result.card_id])]
          : (old.ids || []).filter((value) => value !== result.card_id),
        pendingId: null,
      }))
      setMutationRevision((value) => value + 1)
      return true
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        epoch === generation.current &&
        identity === currentAccount.current
      )
        setState((old) => ({ ...old, error: (reason as Error).message, pendingId: null }))
      return false
    } finally {
      if (write.current === controller) write.current = null
    }
  }
  return {
    ids: state.account === identity ? state.ids : null,
    revision: mutationRevision,
    loading: state.account !== identity || state.loading,
    pendingId: state.account === identity ? state.pendingId : null,
    error: state.account === identity ? state.error : "",
    reload: () => setRevision((value) => value + 1),
    setFavorite,
  }
}

export function FavoriteButton({
  controls,
  cardId,
}: {
  controls: FavoriteControls
  cardId: string
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const marked = !!controls.ids?.includes(cardId)
  return (
    <button
      className="archive-favorite"
      aria-pressed={marked}
      disabled={controls.loading || !controls.ids || !!controls.pendingId}
      onClick={() => void controls.setFavorite(cardId, !marked)}
    >
      <Icon name="star" size={18} />
      {controls.pendingId === cardId
        ? ru
          ? "Сохраняем…"
          : "Saving…"
        : marked
          ? ru
            ? "Убрать из избранного"
            : "Remove from favorites"
          : ru
            ? "В избранное"
            : "Add to favorites"}
    </button>
  )
}

export function FavoriteError({ controls }: { controls: FavoriteControls }) {
  const { language } = useLanguage()
  return controls.error ? (
    <p role="alert">
      {controls.error}{" "}
      {!controls.ids && (
        <button onClick={controls.reload}>
          {language === "ru" ? "Загрузить избранное" : "Reload favorites"}
        </button>
      )}
    </p>
  ) : null
}
