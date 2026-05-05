import { useEffect, useState } from 'react'
import { Typography, Row, Col, Spin, message } from 'antd'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORM_IDS } from '@/constants/platforms'
import { useAccountStore } from '@/stores/accountStore'
import { useQrCodeListener } from '@/hooks/useIpc'
import PlatformCard from '@/components/account/PlatformCard'
import QRLoginDialog from '@/components/account/QRLoginDialog'

const { Title, Paragraph } = Typography

export default function AccountPage() {
  const { accounts, loading, fetchAccounts, startLogin, logout, checkSession } = useAccountStore()
  const [loginPlatform, setLoginPlatform] = useState<PlatformId | null>(null)

  useQrCodeListener()

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const handleLogin = async (platformId: PlatformId) => {
    setLoginPlatform(platformId)
    const success = await startLogin(platformId)
    if (success) {
      message.success('登录成功')
    }
    setTimeout(() => setLoginPlatform(null), 2000)
  }

  const handleLogout = async (accountId: string) => {
    await logout(accountId)
    message.info('已退出登录')
  }

  const getAccount = (platformId: PlatformId) => accounts.find((a) => a.platform === platformId)

  return (
    <div>
      <Title level={3}>账号管理</Title>
      <Paragraph type="secondary">管理各平台登录账号（抖音、小红书、视频号、快手）</Paragraph>

      <Spin spinning={loading}>
        <Row gutter={[24, 24]} style={{ marginTop: 24 }}>
          {PLATFORM_IDS.map((id) => (
            <Col key={id}>
              <PlatformCard
                platformId={id}
                account={getAccount(id)}
                onLogin={handleLogin}
                onLogout={handleLogout}
                onCheckSession={checkSession}
              />
            </Col>
          ))}
        </Row>
      </Spin>

      <QRLoginDialog
        platformId={loginPlatform}
        open={loginPlatform !== null}
        onClose={() => setLoginPlatform(null)}
      />
    </div>
  )
}
