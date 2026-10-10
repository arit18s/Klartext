// shadcn/ui Dialog (Radix), restyled with Klartext tokens: 14 px radius, modal shadow, 150 ms fade + 4 px rise.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-graphite/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { closeLabel?: string }
>(({ className, children, closeLabel = t('common.close'), ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-40px)] w-[calc(100vw-32px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-modal bg-paper shadow-modal',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-1 data-[state=open]:duration-150',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label={closeLabel}
        className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-canvas hover:text-graphite"
      >
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DialogContent.displayName = 'DialogContent'

export const DialogHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('border-b border-line px-5 py-4 pr-14', className)} {...props} />
)

export const DialogBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4', className)} {...props} />
)

export const DialogFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center justify-between gap-3 border-t border-line px-5 py-4', className)} {...props} />
)

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-subtitle font-semibold', className)} {...props} />
))
DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('mt-1 text-small text-muted', className)} {...props} />
))
DialogDescription.displayName = 'DialogDescription'
