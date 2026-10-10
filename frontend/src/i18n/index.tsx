import { createContext, Fragment, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { en, type Key } from './en'
import { de } from './de'

// Interface language only. Backend data (reasons, transcripts, rule texts, keyword phrases) is never translated here.
export type Lang = 'en' | 'de'
export type { Key }

const DICTS: Record<Lang, Record<Key, string>> = { en, de }
const STORAGE_KEY = 'klartext.lang'

function readLang(): Lang {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'de' ? 'de' : 'en'
  } catch {
    return 'en'
  }
}

let current: Lang = typeof window === 'undefined' ? 'en' : readLang()

export const getLang = (): Lang => current
/** Locale for dates and numbers. Swiss German for Deutsch. */
export const locale = (): string => (current === 'de' ? 'de-CH' : 'en-GB')

/** t('inbox.coverage', { done: 3, total: 60 }) → text in the current language, "{name}" placeholders filled. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const text = DICTS[current][key] ?? en[key] ?? key
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

/** Plural: picks `<key>_one` for n = 1, `<key>_other` otherwise; `{n}` is filled with n. */
export function tn(key: string, n: number, vars?: Record<string, string | number>): string {
  return t(`${key}_${n === 1 ? 'one' : 'other'}` as Key, { n, ...vars })
}

/** A label map whose values follow the current language, read like a plain Record. */
export function labels<K extends string>(keys: Record<K, Key>): Record<K, string> {
  const out = {} as Record<K, string>
  for (const k of Object.keys(keys) as K[]) {
    Object.defineProperty(out, k, { enumerable: true, get: () => t(keys[k]) })
  }
  return out
}

/** Lower-case a label inside running text. German nouns keep their capital. */
export const lc = (s: string): string => (current === 'en' ? s.toLowerCase() : s)

/** "a and b", "a, b and c" in the current language. */
export function joinList(words: string[]): string {
  const and = ` ${t('common.and')} `
  return words.length <= 2 ? words.join(and) : `${words.slice(0, -1).join(', ')}${and}${words.at(-1)}`
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} })
export const useLang = () => useContext(LangContext)

/**
 * Holds the interface language (saved in localStorage, English by default). Changing it re-mounts the tree below
 * so every t() call and label map renders again; the query cache sits above and is kept.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current)
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const setLang = useCallback((l: Lang) => {
    current = l
    try {
      window.localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // ignore: the choice then lasts until reload
    }
    setState(l)
  }, [])
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  )
}
