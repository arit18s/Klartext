import { NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Book, ChartLine, Folder, Inbox, List, Settings, SlidersVertical, Users, type LucideIcon } from 'lucide-react'
import { getCalls, getPipelineStatus } from '@/lib/api'
import { useLiveConnection } from './LiveUpdates'
import { LogoMark } from '@/components/Logo'
import { cn } from '@/lib/utils'
import { Segmented } from '@/components/Segmented'
import { t, tn, useLang, type Lang } from '@/i18n'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  count?: number
  /** Overrides the default path match, e.g. Inbox stays active on a call page. */
  active?: boolean
}

function NavEntry({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end
      title={item.label}
      aria-current={item.active ? 'page' : undefined}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center gap-3 rounded-control border px-3 font-medium text-graphite-soft hover:bg-canvas-hover hover:text-graphite',
          'max-lg:justify-center max-lg:px-0',
          (item.active ?? isActive) ? 'border-line bg-paper text-graphite hover:bg-paper' : 'border-transparent',
        )
      }
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="flex-none" />
      <span className="max-lg:sr-only">{item.label}</span>
      {item.count !== undefined && (
        <span className="tabular ml-auto text-[12px] font-medium text-muted max-lg:hidden">{item.count}</span>
      )}
    </NavLink>
  )
}

function Group({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1.5 pt-4 text-small text-muted max-lg:hidden" role="presentation">
      {label}
    </div>
  )
}

/** Pipeline state from GET /api/pipeline/status, kept fresh by pipeline_status events. */
function PipelineDot() {
  const { data, error } = useQuery({ queryKey: ['pipeline'], queryFn: getPipelineStatus, retry: false })
  const connection = useLiveConnection()
  const working = data?.queue.filter((q) => q.stage !== 'failed' && q.stage !== 'waiting_for_asr').length ?? 0
  const waiting = data?.queue.filter((q) => q.stage === 'waiting_for_asr').length ?? 0
  const [tone, text] = error
    ? ['bg-alarm', t('pipelineDot.unreachable')]
    : connection === 'lost'
      ? ['bg-alarm', t('pipelineDot.lost')]
      : !data
        ? ['bg-line', t('pipelineDot.checking')]
        : !data.watching
          ? ['bg-muted', t('pipelineDot.paused')]
          : working
            ? ['bg-review', tn('pipelineDot.processing', working)]
            : waiting
              ? ['bg-review', t('pipelineDot.toTranscribe', { n: waiting })]
              : ['bg-clear', t('pipelineDot.watching')]
  return (
    <div
      role="status"
      title={text}
      className="flex items-center gap-2 px-3 text-small text-graphite-soft max-lg:justify-center max-lg:px-0"
    >
      <span className={cn('h-2 w-2 flex-none rounded-full', tone)} aria-hidden="true" />
      <span className="max-lg:sr-only">{text}</span>
    </div>
  )
}

/** English / Deutsch for the interface. Backend data (reasons, transcripts, rules) keeps its own language. */
function LanguageSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div className="px-1 max-lg:px-0">
      <Segmented<Lang>
        label={t('nav.language')}
        value={lang}
        onChange={setLang}
        className="max-lg:flex-col"
        options={[
          { value: 'en', label: 'English' },
          { value: 'de', label: 'Deutsch' },
        ]}
      />
    </div>
  )
}

/** Fixed left sidebar, 232 px; collapses to 64 px icons below 1024 px (04_FRONTEND_GUIDELINES.md section 5). */
export function Sidebar() {
  const { data } = useQuery({ queryKey: ['calls', {}], queryFn: () => getCalls() })
  const counts = data?.counts
  // A call opens from the Inbox (and from Outcept deep links), so the design keeps Inbox active there.
  const onCall = useLocation().pathname.startsWith('/calls/')

  return (
    <aside className="sticky top-0 flex print:hidden h-screen w-sidebar flex-none flex-col gap-2 overflow-y-auto border-r border-line bg-canvas px-4 py-5 max-lg:w-sidebar-collapsed max-lg:px-2">
      <div className="flex h-9 items-center gap-2.5 px-1 max-lg:justify-center max-lg:px-0">
        <LogoMark />
        <span className="text-[18px] font-semibold tracking-[-0.01em] max-lg:sr-only">Klartext</span>
      </div>

      <nav aria-label={t('nav.main')} className="flex flex-col gap-0.5 max-lg:gap-1 max-lg:pt-4">
        <Group label={t('nav.groupReview')} />
        <NavEntry
          item={{ to: '/', label: t('nav.inbox'), icon: Inbox, count: counts?.flagged, active: onCall || undefined }}
        />
        <NavEntry item={{ to: '/calls', label: t('nav.allCalls'), icon: List, count: counts?.total }} />
        <Group label={t('nav.groupConfigure')} />
        <NavEntry item={{ to: '/tuning', label: t('nav.tuning'), icon: SlidersVertical }} />
        <NavEntry item={{ to: '/rules', label: t('nav.rules'), icon: Book }} />
        <Group label={t('nav.groupInsight')} />
        <NavEntry item={{ to: '/quality', label: t('nav.quality'), icon: ChartLine }} />
        <NavEntry item={{ to: '/advisors', label: t('nav.advisors'), icon: Users }} />
        <Group label={t('nav.groupSystem')} />
        <NavEntry item={{ to: '/pipeline', label: t('nav.pipeline'), icon: Folder }} />
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-6">
        <NavEntry item={{ to: '/settings', label: t('nav.settings'), icon: Settings }} />
        <LanguageSwitch />
        <PipelineDot />
        <div className="px-3 text-[12px] leading-[18px] text-muted max-lg:hidden">{t('nav.builtFor')}</div>
      </div>
    </aside>
  )
}
