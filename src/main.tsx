import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'dayjs/locale/zh-cn'
import dayjs from 'dayjs'
import App from './App'
import { registerNetworkListener } from './stores/uiStore'
import './styles/global.css'

dayjs.locale('zh-cn')
registerNetworkListener()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#0071e3',
          colorSuccess: '#34c759',
          colorError: '#ff3b30',
          colorWarning: '#ff9500',
          colorInfo: '#5ac8fa',
          borderRadius: 8,
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          fontSize: 14,
          colorBgContainer: 'rgba(255, 255, 255, 0.78)',
          colorBgLayout: '#F8F9FA',
          colorBorder: 'rgba(0, 0, 0, 0.06)',
          colorBorderSecondary: 'rgba(0, 0, 0, 0.04)',
          colorText: '#1d1d1f',
          colorTextSecondary: '#86868b',
          colorTextTertiary: '#aeaeb2',
          controlHeight: 36,
          padding: 16,
          paddingSM: 12,
          paddingLG: 24,
          margin: 16,
          marginSM: 12,
          marginLG: 24,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.02)',
          boxShadowSecondary: '0 4px 16px rgba(0, 0, 0, 0.03), 0 20px 56px rgba(0, 0, 0, 0.03)',
        },
        components: {
          Button: {
            borderRadius: 8,
            controlHeight: 36,
            fontWeight: 500,
          },
          Card: {
            borderRadiusLG: 16,
            paddingLG: 20,
          },
          Input: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Select: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Table: {
            borderRadius: 12,
            headerBg: 'rgba(255, 255, 255, 0.5)',
          },
          Modal: {
            borderRadiusLG: 24,
          },
          Tabs: {
            inkBarHeight: 2,
          },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
)
