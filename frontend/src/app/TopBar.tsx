import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'

/** 56 px top bar: page title (or breadcrumb) on the left, global search on the right. "/" focuses search. */
export function TopBar({ children }: { children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const onAllCalls = useLocation().pathname === '/calls'
  const [params] = useSearchParams()
  const [text, setText] = useState(onAllCalls ? (params.get('q') ?? '') : '')

  useEffect(() => {
    if (onAllCalls) setText(params.get('q') ?? '')
  }, [onAllCalls, params])

  // Search runs on All calls: call ID, advisor or transcript text.
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    navigate(q ? `/calls?q=${encodeURIComponent(q)}` : '/calls')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key !== '/' || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="flex min-h-topbar flex-wrap items-center justify-between gap-3 border-b border-line px-8 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
      <form role="search" onSubmit={submit} className="w-[min(360px,100%)]">
        <label className="flex h-9 w-full items-center focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-graphite gap-2 rounded-control border border-line bg-paper px-3 text-muted">
          <Search size={16} strokeWidth={1.75} aria-hidden="true" className="flex-none" />
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setText('')
                input.current?.blur()
              }
            }}
            type="search"
            placeholder="Search call ID, advisor or transcript"
            aria-label="Search calls"
            className="min-w-0 flex-1 bg-transparent text-body text-graphite outline-none placeholder:text-muted focus-visible:outline-none"
          />
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-canvas px-[5px] font-sans text-[11.5px] text-muted">
            /
          </kbd>
        </label>
      </form>
    </header>
  )
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-subtitle font-semibold">{children}</h1>
}
