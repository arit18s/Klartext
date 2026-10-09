import { useState } from 'react'
import { Plus, X } from 'lucide-react'

/** Phrase chips in quote type (they are words said in calls), with remove and an inline "+ Add". */
export function PhraseList({
  phrases,
  onChange,
  label,
}: {
  phrases: string[]
  onChange: (p: string[]) => void
  label: string
}) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const commit = () => {
    const p = text.trim()
    if (p && !phrases.some((x) => x.toLowerCase() === p.toLowerCase())) onChange([...phrases, p])
    setText('')
    setAdding(false)
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {phrases.map((p) => (
        <span
          key={p}
          className="group inline-flex h-[26px] items-center gap-1 rounded-full border border-line bg-canvas pl-2.5 pr-1 font-quote text-[15px] italic"
        >
          {p}
          <button
            type="button"
            onClick={() => onChange(phrases.filter((x) => x !== p))}
            aria-label={`Remove ${label} phrase ${p}`}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full font-sans not-italic text-muted hover:bg-line hover:text-graphite"
          >
            <X size={12} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={text}
          aria-label={`New ${label} phrase`}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setText('')
              setAdding(false)
            }
          }}
          className="h-[26px] w-40 rounded-full border border-graphite px-2.5 font-quote text-[15px] italic"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label={`Add ${label} phrase`}
          className="inline-flex h-[26px] items-center gap-1 rounded-full border border-dashed border-line px-2 text-[12px] text-muted hover:border-muted hover:text-graphite"
        >
          <Plus size={12} strokeWidth={1.75} aria-hidden="true" />
          Add
        </button>
      )}
    </div>
  )
}
