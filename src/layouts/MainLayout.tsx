import { Outlet, useLocation } from 'react-router-dom'
import AppSidebar from '@/components/common/AppSidebar'
import PageTransition from '@/components/common/PageTransition'
import { useAutoCheckSessions } from '@/hooks/useAutoCheckSessions'

export default function MainLayout() {
  const location = useLocation()

  // 应用启动时自动检查所有已登录账号的会话状态
  useAutoCheckSessions()

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#F8F9FA' }}>
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
