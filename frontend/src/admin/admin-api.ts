import { apiLanguage } from "../i18n"

export class AdminApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "AdminApiError"
    this.status = status
  }
}

export async function adminApi<T>(url: string, csrf: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  headers.set("Accept-Language", apiLanguage())
  if (init.body) headers.set("Content-Type", "application/json")
  if (!["GET", "HEAD"].includes((init.method || "GET").toUpperCase())) {
    headers.set("X-CSRF-Token", csrf)
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
  })
  const data = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }))
  if (!response.ok) {
    throw new AdminApiError(data.detail || `HTTP ${response.status}`, response.status)
  }
  return data as T
}
