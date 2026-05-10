import { useState, useEffect } from 'react'
import { Form, Input, Switch, Button, message, Tag, Radio, Alert } from 'antd'
import { SaveOutlined, FolderOpenOutlined, ThunderboltOutlined, DesktopOutlined } from '@ant-design/icons'
import { IPC_CHANNELS } from '@/constants/ipc-channels'
import { ipcInvoke } from '@/utils/ipc'

interface AppSettings {
  ffmpegPath: string
  proxy: string
  autoBackup: boolean
  logLevel: string
  publishMode: 'api' | 'browser'
}

const DEFAULT_SETTINGS: AppSettings = {
  ffmpegPath: '',
  proxy: '',
  autoBackup: true,
  logLevel: 'info',
  publishMode: 'api'
}

export default function SettingsPage() {
  const [form] = Form.useForm()
  const [appVersion, setAppVersion] = useState('')
  const [saving, setSaving] = useState(false)
  const [publishMode, setPublishMode] = useState<'api' | 'browser'>('api')

  useEffect(() => {
    const saved = localStorage.getItem('app-settings')
    if (saved) {
      try {
        const settings = JSON.parse(saved) as AppSettings
        form.setFieldsValue(settings)
        setPublishMode(settings.publishMode || 'api')
      } catch {
        form.setFieldsValue(DEFAULT_SETTINGS)
      }
    } else {
      form.setFieldsValue(DEFAULT_SETTINGS)
    }

    // Load current publish mode from main process
    ipcInvoke<{ mode: string }>(IPC_CHANNELS.PUBLISH_GET_MODE).then((res) => {
      if (res.success && res.data) {
        setPublishMode(res.data.mode as 'api' | 'browser')
        form.setFieldValue('publishMode', res.data.mode)
      }
    }).catch(() => {})

    window.electron.ipcRenderer.invoke<{ version: string }>(IPC_CHANNELS.APP_GET_VERSION).then((res) => {
      if (res.success && res.data) {
        setAppVersion(res.data.version)
      }
    }).catch(() => {})
  }, [form])

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = form.getFieldsValue()
      localStorage.setItem('app-settings', JSON.stringify(values))

      // Update publish mode in main process
      if (values.publishMode) {
        await ipcInvoke(IPC_CHANNELS.PUBLISH_SET_MODE, values.publishMode)
        setPublishMode(values.publishMode)
      }

      message.success('设置已保存')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32 }}>
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
          设置
        </h1>
        <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>
          配置应用参数与偏好
        </p>
      </div>

      {/* Settings Form */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          border: '1px solid rgba(0, 0, 0, 0.06)',
          padding: 24,
          marginBottom: 20,
        }}
      >
        <h3
          style={{
            fontFamily: "'Sora', sans-serif",
            fontSize: 15,
            fontWeight: 600,
            color: '#1d1d1f',
            marginBottom: 20,
            letterSpacing: '-0.01em',
          }}
        >
          应用配置
        </h3>
        <Form form={form} layout="vertical" initialValues={DEFAULT_SETTINGS}>
          <Form.Item label="FFmpeg 路径" name="ffmpegPath" tooltip="留空则使用系统 PATH 中的 FFmpeg">
            <Input
              placeholder="例如: C:\ffmpeg\bin\ffmpeg.exe"
              suffix={<FolderOpenOutlined style={{ color: '#aeaeb2' }} />}
            />
          </Form.Item>

          <Form.Item label="网络代理" name="proxy" tooltip="HTTP 代理地址，留空则不使用代理">
            <Input placeholder="例如: http://127.0.0.1:7890" />
          </Form.Item>

          <Form.Item label="自动备份数据库" name="autoBackup" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="日志级别" name="logLevel">
            <Input style={{ width: 200 }} placeholder="debug / info / warn / error" />
          </Form.Item>

          <Form.Item label="发布模式" name="publishMode" tooltip="API 模式更快更稳定，浏览器模式兼容性更好">
            <Radio.Group
              onChange={(e) => setPublishMode(e.target.value)}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <Radio.Button value="api" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ThunderboltOutlined /> API 模式（推荐）
              </Radio.Button>
              <Radio.Button value="browser" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <DesktopOutlined /> 浏览器模式
              </Radio.Button>
            </Radio.Group>
          </Form.Item>

          {publishMode === 'api' && (
            <Alert
              type="success"
              showIcon
              message="API 模式"
              description="直接调用平台接口发布，速度快 10 倍+，稳定性更高，封号风险低。"
              style={{ marginBottom: 16, borderRadius: 8 }}
            />
          )}
          {publishMode === 'browser' && (
            <Alert
              type="warning"
              showIcon
              message="浏览器模式"
              description="通过浏览器自动化发布，兼容性好但速度较慢，可能被平台检测。"
              style={{ marginBottom: 16, borderRadius: 8 }}
            />
          )}

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </div>

      {/* App Info */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          border: '1px solid rgba(0, 0, 0, 0.06)',
          padding: 24,
        }}
      >
        <h3
          style={{
            fontFamily: "'Sora', sans-serif",
            fontSize: 15,
            fontWeight: 600,
            color: '#1d1d1f',
            marginBottom: 20,
            letterSpacing: '-0.01em',
          }}
        >
          关于 Flow
        </h3>

        <div style={{ display: 'grid', gap: 14 }}>
          <InfoRow label="应用名称" value="Flow" />
          <InfoRow label="版本" value={<Tag color="blue">{appVersion || '0.1.0'}</Tag>} />
          <InfoRow
            label="技术栈"
            value={
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Tag>Electron 33</Tag>
                <Tag>React 18</Tag>
                <Tag>TypeScript</Tag>
              </div>
            }
          />
          <InfoRow
            label="支持平台"
            value={
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Tag color="red">抖音</Tag>
                <Tag color="pink">小红书</Tag>
                <Tag color="green">视频号</Tag>
                <Tag color="orange">快手</Tag>
              </div>
            }
          />
        </div>

        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid rgba(0, 0, 0, 0.04)',
            fontSize: 12,
            color: '#aeaeb2',
            lineHeight: 1.8,
          }}
        >
          <div>Create once. Flow everywhere.</div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span
        style={{
          fontSize: 13,
          color: '#86868b',
          width: 80,
          flexShrink: 0,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: '#1d1d1f' }}>{value}</span>
    </div>
  )
}
