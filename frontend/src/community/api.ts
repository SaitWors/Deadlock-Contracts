import { useEffect, useState } from "react"
import { apiLanguage, useLanguage } from "../i18n"

export async function request<T>(url: string, csrf = "", init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  headers.set("Accept-Language", apiLanguage())
  if (init.body) headers.set("Content-Type", "application/json")
  if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase()))
    headers.set("X-CSRF-Token", csrf)
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" })
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(typeof data?.detail === "string" ? data.detail : `HTTP ${response.status}`)
  return data as T
}

export function useResource<T>(url: string) {
  const { language } = useLanguage()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError("")
    setLoading(true)
    request<T>(url, "", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError((reason as Error).message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, language, revision])
  return { data, error, loading, setData, reload: () => setRevision((value) => value + 1) }
}
