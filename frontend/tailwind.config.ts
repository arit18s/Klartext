import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

// Tokens from docs/04_FRONTEND_GUIDELINES.md (sections 3–5). Values live as CSS variables in src/index.css.
const color = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        graphite: { DEFAULT: color('graphite'), soft: color('graphite-soft') },
        paper: color('paper'),
        canvas: { DEFAULT: color('canvas'), hover: color('canvas-hover') },
        line: color('line'),
        muted: color('muted'),
        signal: { DEFAULT: color('signal'), soft: color('signal-soft') },
        alarm: { DEFAULT: color('alarm'), soft: color('alarm-soft') },
        review: { DEFAULT: color('review'), soft: color('review-soft') },
        clear: { DEFAULT: color('clear'), soft: color('clear-soft') },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        quote: ['Newsreader', 'Georgia', 'serif'],
      },
      fontSize: {
        display: ['28px', { lineHeight: '34px', fontWeight: '600' }],
        title: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        subtitle: ['16px', { lineHeight: '24px', fontWeight: '500' }],
        body: ['14px', { lineHeight: '22px' }],
        quote: ['17px', { lineHeight: '27px' }],
        small: ['12.5px', { lineHeight: '18px' }],
      },
      borderRadius: {
        control: '6px',
        panel: '10px',
        modal: '14px',
      },
      boxShadow: {
        modal: '0 12px 32px rgba(30,33,38,0.12)',
      },
      width: { sidebar: '232px', 'sidebar-collapsed': '64px' },
      height: { topbar: '56px' },
      maxWidth: { content: '1440px' },
    },
  },
  plugins: [animate],
} satisfies Config
