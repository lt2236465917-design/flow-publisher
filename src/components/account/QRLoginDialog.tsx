import { Modal, Spin, Image } from 'antd'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'
import { useAccountStore } from '@/stores/accountStore'

interface Props {
  platformId: PlatformId | null
  open: boolean
  onClose: () => void
}

const STATUS_LABELS: Record<string, string> = {
  launching: '正在启动浏览器...',
  waiting_qr: '请用手机扫描二维码',
  scanning: '等待确认...',
  verifying: '验证登录中...',
  success: '登录成功！',
  error: '登录失败'
}

export default function QRLoginDialog({ platformId, open, onClose }: Props) {
  const loginProgress = useAccountStore((s) => (platformId ? s.loginProgress[platformId] : null))
  const platform = platformId ? PLATFORMS[platformId] : null

  const status = loginProgress?.status ?? 'idle'
  const qrDataUrl = loginProgress?.qrDataUrl
  const error = loginProgress?.error

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={380}
      centered
      maskClosable={status === 'success' || status === 'error'}
      title={null}
      styles={{
        content: {
          padding: 0,
          overflow: 'hidden',
        },
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '24px 24px 0',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: "'Sora', sans-serif",
            fontSize: 18,
            fontWeight: 600,
            color: '#1d1d1f',
            letterSpacing: '-0.02em',
            marginBottom: 4,
          }}
        >
          {platform?.displayName ?? ''} 登录
        </div>
        <div style={{ fontSize: 13, color: '#86868b' }}>
          {STATUS_LABELS[status] || '准备中...'}
        </div>
      </div>

      {/* Content */}
      <div style={{ textAlign: 'center', padding: '24px 24px 32px' }}>
        {status === 'launching' && (
          <div style={{ padding: '32px 0' }}>
            <Spin size="large" />
          </div>
        )}

        {(status === 'waiting_qr' || status === 'scanning') && qrDataUrl && (
          <div>
            <div
              style={{
                borderRadius: 14,
                overflow: 'hidden',
                border: '1px solid rgba(0, 0, 0, 0.06)',
                display: 'inline-block',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
              }}
            >
              <Image src={qrDataUrl} width={240} height={240} preview={false} />
            </div>
          </div>
        )}

        {status === 'waiting_qr' && !qrDataUrl && (
          <div style={{ padding: '32px 0' }}>
            <Spin size="large" />
          </div>
        )}

        {status === 'success' && (
          <div
            style={{
              fontSize: 48,
              lineHeight: 1,
              marginBottom: 12,
            }}
          >
            ✓
          </div>
        )}

        {status === 'error' && (
          <div>
            <div
              style={{
                fontSize: 14,
                color: '#ff3b30',
                fontWeight: 500,
              }}
            >
              {error || '登录失败，请重试'}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
