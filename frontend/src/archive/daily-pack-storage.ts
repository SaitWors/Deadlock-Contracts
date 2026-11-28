const storageName = (account: string) => `dc-daily-pack:${account}`

export function savedKey(account: string) {
  try {
    return sessionStorage.getItem(storageName(account)) || ""
  } catch {
    return ""
  }
}

export function saveKey(account: string, key: string) {
  try {
    if (key) sessionStorage.setItem(storageName(account), key)
    else sessionStorage.removeItem(storageName(account))
  } catch {
    /* Claims remain idempotent on the server when storage is blocked. */
  }
}
