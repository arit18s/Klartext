import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from './Layout'
import { ToastProvider } from '@/components/Toast'
import Inbox from '@/pages/Inbox'
import AllCalls from '@/pages/AllCalls'
import CallView from '@/pages/CallView'
import Tuning from '@/pages/Tuning'
import Rules from '@/pages/Rules'
import Quality from '@/pages/Quality'
import Advisors from '@/pages/Advisors'
import Pipeline from '@/pages/Pipeline'
import Settings from '@/pages/Settings'
import NotFound from '@/pages/NotFound'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Inbox />} />
              <Route path="/calls" element={<AllCalls />} />
              {/* Deep link from the Outcept trigger API: /calls/:id?t=<seconds> (05_BACKEND_STRUCTURE.md section 7). */}
              <Route path="/calls/:id" element={<CallView />} />
              <Route path="/tuning" element={<Tuning />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/quality" element={<Quality />} />
              <Route path="/advisors" element={<Advisors />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
