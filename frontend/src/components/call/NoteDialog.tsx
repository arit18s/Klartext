import { useState, type ReactElement } from 'react'
import type { FeedbackLabel } from '@/lib/types'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import { Button } from '../ui/button'
import type { FeedbackAction } from './VerdictHeader'

/** Feedback with an optional note (max 2000 characters, as in the contract). */
export function NoteDialog({
  title,
  description,
  actions,
  onSubmit,
  children,
}: {
  title: string
  description: string
  actions: { label: FeedbackLabel; text: string; primary?: boolean }[]
  onSubmit: (a: FeedbackAction) => void
  children: ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setNote('')
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Note</span>
            <textarea
              value={note}
              maxLength={2000}
              rows={4}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-control border border-line p-3 text-body"
            />
          </label>
        </DialogBody>
        <DialogFooter className="justify-end">
          {actions.map((a) => (
            <Button
              key={a.label}
              variant={a.primary ? 'primary' : 'secondary'}
              onClick={() => {
                onSubmit({ label: a.label, note: note.trim() || null })
                setOpen(false)
              }}
            >
              {a.text}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
