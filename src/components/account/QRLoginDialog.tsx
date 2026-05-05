import { Modal, Spin, Typography, Image } from 'antd'
import type { PlatformId } from '@/constants/platforms'
import { PLATFORMS } from '@/constants/platforms'
import { useAccountStore } from '@/stores/accountStore'

const { Text } = Typography

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
      title={`${platform?.displayName ?? ''} 登录`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={400}
      centered
      maskClosable={status === 'success' || status === 'error'}
    >
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        {status === 'launching' && <Spin size="large" tip="正在启动浏览器..." />}

        {(status === 'waiting_qr' || status === 'scanning') && qrDataUrl && (
          <div>
            <Image src={qrDataUrl} width={240} height={240} preview={false} />
            <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
              {STATUS_LABELS[status]}
            </Text>
          </div>
        )}

        {status === 'waiting_qr' && !qrDataUrl && <Spin size="large" tip="正在获取二维码..." />}

        {status === 'success' && <Text type="success">登录成功！</Text>}

        {status === 'error' && <Text type="danger">{error || '登录失败，请重试'}</Text>}
      </div>
    </Modal>
  )
}
