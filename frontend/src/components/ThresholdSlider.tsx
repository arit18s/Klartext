import * as SliderPrimitive from '@radix-ui/react-slider'
import type { Thresholds } from '@/lib/types'
import { t } from '@/i18n'

/**
 * One track, two handles: "Review from" and "Alert from" (04_FRONTEND_GUIDELINES.md section 6).
 * Track segments in the clear / review / alarm soft colours. Radix gives arrow keys, Page Up/Down, Home/End.
 */
export function ThresholdSlider({ value, onChange }: { value: Thresholds; onChange: (t: Thresholds) => void }) {
  const { review, alarm } = value
  const track = `linear-gradient(to right, rgb(var(--clear-soft)) 0 ${review}%, rgb(var(--review-soft)) ${review}% ${alarm}%, rgb(var(--alarm-soft)) ${alarm}% 100%)`
  return (
    <div className="px-2.5">
      <SliderPrimitive.Root
        min={0}
        max={100}
        step={1}
        minStepsBetweenThumbs={0}
        value={[review, alarm]}
        onValueChange={([r, a]) => onChange({ review: r, alarm: a })}
        className="relative flex h-6 touch-none select-none items-center"
        aria-label={t('slider.label')}
      >
        <SliderPrimitive.Track className="relative h-1 grow rounded-full" style={{ background: track }}>
          <SliderPrimitive.Range className="absolute h-full" />
        </SliderPrimitive.Track>
        {(['review', 'alarm'] as const).map((k) => (
          <SliderPrimitive.Thumb
            key={k}
            aria-label={t(k === 'review' ? 'slider.reviewFrom' : 'slider.alertFrom')}
            className="relative block h-[22px] w-[22px] rounded-full border-2 border-graphite bg-paper focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="pointer-events-none absolute left-1/2 top-7 flex -translate-x-1/2 flex-col items-center whitespace-nowrap">
              <span className={`tabular text-title ${k === 'review' ? 'text-review' : 'text-alarm'}`}>{value[k]}</span>
              <span className="text-small text-muted">{t(k === 'review' ? 'slider.reviewFrom' : 'slider.alertFrom')}</span>
            </span>
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Root>
    </div>
  )
}
