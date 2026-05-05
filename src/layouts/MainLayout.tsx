import { Layout } from 'antd'
import { Outlet } from 'react-router-dom'
import AppSidebar from '@/components/common/AppSidebar'

const { Content } = Layout

export default function MainLayout() {
  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <AppSidebar />
      <Layout style={{ overflow: 'hidden' }}>
        <Content style={{ padding: 24, overflow: 'auto', height: '100%' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
