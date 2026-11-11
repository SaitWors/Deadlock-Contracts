import { useEffect, useState } from "react"
import { apiLanguage, useLanguage } from "../i18n"

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

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
    throw new ApiError(
      typeof data?.detail === "string" ? data.detail : `HTTP ${response.status}`,
      response.status,
    )
  return data as T
}

export function useResource<T>(url: string, { reloadOnLanguageChange = true } = {}) {
  const { language } = useLanguage()
  const requestLanguage = reloadOnLanguageChange ? language : null
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
  }, [url, requestLanguage, revision])
  return { data, error, loading, setData, reload: () => setRevision((value) => value + 1) }
}
