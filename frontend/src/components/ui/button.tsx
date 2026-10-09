import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Buttons from 04_FRONTEND_GUIDELINES.md section 6. Labels are verbs.
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:flex-none',
  {
    variants: {
      variant: {
        primary: 'border-graphite bg-graphite text-paper hover:bg-black',
        secondary: 'border-line bg-paper text-graphite hover:bg-canvas',
        destructive: 'border-line bg-paper text-alarm hover:bg-alarm-soft',
        ghost: 'border-transparent bg-transparent text-muted hover:bg-canvas hover:text-graphite',
      },
      size: {
        default: 'h-9 px-3.5 text-body',
        sm: 'h-[30px] px-2.5 text-[13px]',
        md: 'h-8 px-3 text-body',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
