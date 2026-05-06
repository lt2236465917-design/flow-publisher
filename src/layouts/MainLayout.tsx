import { Layout } from 'antd'
import { Outlet, useLocation } from 'react-router-dom'
import AppSidebar from '@/components/common/AppSidebar'
import PageTransition from '@/components/common/PageTransition'

const { Content } = Layout

export default function MainLayout() {
  const location = useLocation()

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <AppSidebar />
      <Layout style={{ overflow: 'hidden' }}>
        <Content style={{ padding: 24, overflow: 'auto', height: '100%' }}>
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </Content>
      </Layout>
    </Layout>
  )
}
