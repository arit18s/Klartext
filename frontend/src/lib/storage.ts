// Per-viewer conveniences only (e.g. evaluation mode on). Storage can be missing or throw; never rely on it.
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v === 'true'
  } catch {
    return fallback
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // ignore
  }
}
