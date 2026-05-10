import { Outlet, useLocation } from 'react-router-dom'
import AppSidebar from '@/components/common/AppSidebar'
import PageTransition from '@/components/common/PageTransition'

export default function MainLayout() {
  const location = useLocation()

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f5f7' }}>
      <AppSidebar />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '28px 32px',
          }}
        >
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </div>
      </div>
    </div>
  )
}
