import { NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Book, ChartLine, Folder, Inbox, List, Settings, SlidersVertical, Users, type LucideIcon } from 'lucide-react'
import { getCalls, getPipelineStatus } from '@/lib/api'
import { useLiveConnection } from './LiveUpdates'
import { LogoMark } from '@/components/Logo'
import { cn } from '@/lib/utils'

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
    ? ['bg-alarm', 'Pipeline not reachable']
    : connection === 'lost'
      ? ['bg-alarm', 'Live updates lost']
      : !data
        ? ['bg-line', 'Checking pipeline…']
        : !data.watching
          ? ['bg-muted', 'Watching paused']
          : working
            ? ['bg-review', `Processing ${working} ${working === 1 ? 'call' : 'calls'}`]
            : waiting
              ? ['bg-review', `${waiting} to transcribe`]
              : ['bg-clear', 'Pipeline watching']
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

/** Fixed left sidebar, 232 px; collapses to 64 px icons below 1024 px (04_FRONTEND_GUIDELINES.md section 5). */
export function Sidebar() {
  const { data } = useQuery({ queryKey: ['calls', {}], queryFn: () => getCalls() })
  const counts = data?.counts
  // A call opens from the Inbox (and from Outcept deep links), so the design keeps Inbox active there.
  const onCall = useLocation().pathname.startsWith('/calls/')

  return (
    <aside className="sticky top-0 flex h-screen w-sidebar flex-none flex-col gap-2 overflow-y-auto border-r border-line bg-canvas px-4 py-5 max-lg:w-sidebar-collapsed max-lg:px-2">
      <div className="flex h-9 items-center gap-2.5 px-1 max-lg:justify-center max-lg:px-0">
        <LogoMark />
        <span className="text-[18px] font-semibold tracking-[-0.01em] max-lg:sr-only">Klartext</span>
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5 max-lg:gap-1 max-lg:pt-4">
        <Group label="Review" />
        <NavEntry
          item={{ to: '/', label: 'Inbox', icon: Inbox, count: counts?.flagged, active: onCall || undefined }}
        />
        <NavEntry item={{ to: '/calls', label: 'All calls', icon: List, count: counts?.total }} />
        <Group label="Configure" />
        <NavEntry item={{ to: '/tuning', label: 'Tuning', icon: SlidersVertical }} />
        <NavEntry item={{ to: '/rules', label: 'Rules', icon: Book }} />
        <Group label="Insight" />
        <NavEntry item={{ to: '/quality', label: 'Quality', icon: ChartLine }} />
        <NavEntry item={{ to: '/advisors', label: 'Advisors', icon: Users }} />
        <Group label="System" />
        <NavEntry item={{ to: '/pipeline', label: 'Pipeline', icon: Folder }} />
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-6">
        <NavEntry item={{ to: '/settings', label: 'Settings', icon: Settings }} />
        <PipelineDot />
        <div className="px-3 text-[12px] leading-[18px] text-muted max-lg:hidden">Built for Inventx and Outcept</div>
      </div>
    </aside>
  )
}
