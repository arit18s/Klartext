import { Outlet } from 'react-router-dom'
import { LiveUpdates } from './LiveUpdates'
import { Sidebar } from './Sidebar'
import { t } from '@/i18n'

export function Layout() {
  return (
    <LiveUpdates>
      <div className="flex min-h-screen bg-paper">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-paper focus:px-3 focus:py-2"
        >
          {t('nav.skip')}
        </a>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </LiveUpdates>
  )
}
