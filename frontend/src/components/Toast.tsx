import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ToastItem {
  id: number
  text: string
  tone: 'default' | 'error'
}

const ToastContext = createContext<(text: string, tone?: ToastItem['tone']) => void>(() => {})

/** Toasts use the same verb as the button: "Mark as false alarm" → "Marked as false alarm". */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const show = useCallback((text: string, tone: ToastItem['tone'] = 'default') => {
    const id = nextId.current++
    setItems((all) => [...all, { id, text, tone }])
    window.setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), tone === 'error' ? 8000 : 4000)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 print:hidden right-6 z-[60] flex flex-col items-end gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'max-w-[420px] rounded-panel px-4 py-3 shadow-modal animate-in fade-in-0 slide-in-from-bottom-1 duration-150',
              t.tone === 'error' ? 'border border-alarm/30 bg-paper text-alarm' : 'bg-graphite text-paper',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
