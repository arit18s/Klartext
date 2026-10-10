import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Family, HelperFamily } from '@/lib/types'
import { FAMILY_LABEL } from '@/lib/format'
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
import { t } from '@/i18n'

const input = 'h-9 w-full rounded-control border border-line bg-paper px-3 text-body'
const split = (s: string) => [
  ...new Set(
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  ),
]

export interface NewKeyword {
  label: string
  family: Family | HelperFamily
  de: string[]
  gsw: string[]
}

export function AddKeywordDialog({ onAdd }: { onAdd: (k: NewKeyword) => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [family, setFamily] = useState<Family | HelperFamily>('trade')
  const [de, setDe] = useState('')
  const [gsw, setGsw] = useState('')
  const valid = label.trim() !== '' && split(de).length + split(gsw).length > 0
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) [setLabel, setDe, setGsw].forEach((f) => f(''))
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {t('addKeyword.button')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addKeyword.button')}</DialogTitle>
          <DialogDescription>
            {t('addKeyword.desc')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t('addKeyword.keyword')}</span>
            <input
              className={input}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('addKeyword.placeholder')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t('addKeyword.family')}</span>
            <select
              className={input}
              value={family}
              onChange={(e) => setFamily(e.target.value as Family | HelperFamily)}
            >
              {(Object.keys(FAMILY_LABEL) as (Family | HelperFamily)[]).map((f) => (
                <option key={f} value={f}>
                  {FAMILY_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t('addKeyword.de')}</span>
            <input
              className={input}
              value={de}
              onChange={(e) => setDe(e.target.value)}
              placeholder={t('addKeyword.separate')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t('addKeyword.gsw')}</span>
            <input
              className={input}
              value={gsw}
              onChange={(e) => setGsw(e.target.value)}
              placeholder={t('addKeyword.separate')}
            />
          </label>
        </DialogBody>
        <DialogFooter className="justify-end">
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              onAdd({ label: label.trim(), family, de: split(de), gsw: split(gsw) })
              setOpen(false)
            }}
          >
            {t('addKeyword.button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
