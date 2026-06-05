import { useEffect, useState } from 'react'
import { Spin, message, Button } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORM_IDS } from '@/constants/platforms'
import { useAccountStore } from '@/stores/accountStore'
import { useQrCodeListener } from '@/hooks/useIpc'
import PlatformCard from '@/components/account/PlatformCard'
import QRLoginDialog from '@/components/account/QRLoginDialog'

// 模块级别变量，确保只检查一次
let hasCheckedSessions = false

export default function AccountPage() {
  const { accounts, loading, fetchAccounts, startLogin, checkAllSessions, checkingSessions } = useAccountStore()
  const [loginPlatform, setLoginPlatform] = useState<PlatformId | null>(null)

  useQrCodeListener()

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  // 应用启动时自动检查所有已登录账号的会话状态
  useEffect(() => {
    if (hasCheckedSessions || checkingSessions) return

    hasCheckedSessions = true

    // 延迟 1.5 秒执行，让应用先完成初始化
    const timer = setTimeout(() => {
      console.log('[AccountPage] Auto-checking all sessions...')
      checkAllSessions()
    }, 1500)

    return () => clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async (platformId: PlatformId) => {
    setLoginPlatform(platformId)
    const success = await startLogin(platformId)
    if (success) {
      message.success('登录成功')
    }
    setTimeout(() => setLoginPlatform(null), 2000)
  }

  const getAccount = (platformId: PlatformId) => accounts.find((a) => a.platform === platformId)

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1
            style={{
              fontFamily: "'Sora', sans-serif",
              fontSize: 28,
              fontWeight: 700,
              color: '#1d1d1f',
              letterSpacing: '-0.03em',
              marginBottom: 6,
            }}
          >
            账号管理
          </h1>
          <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>
            连接你的平台账号，开始跨平台发布
          </p>
        </div>
        <Button
          icon={<SyncOutlined spin={checkingSessions} />}
          loading={checkingSessions}
          onClick={() => checkAllSessions()}
          style={{ marginTop: 4 }}
        >
          检查登录状态
        </Button>
      </div>

      <Spin spinning={loading}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 16,
          }}
        >
          {PLATFORM_IDS.map((id) => (
            <PlatformCard
              key={id}
              platformId={id}
              account={getAccount(id)}
              onLogin={handleLogin}
            />
          ))}
        </div>
      </Spin>

      <QRLoginDialog
        platformId={loginPlatform}
        open={loginPlatform !== null}
        onClose={() => setLoginPlatform(null)}
      />
    </div>
  )
}
