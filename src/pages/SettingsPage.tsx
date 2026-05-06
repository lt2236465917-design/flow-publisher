import { useState, useEffect } from 'react'
import { Typography, Card, Form, Input, Switch, Button, Divider, Space, message, Tag, Descriptions } from 'antd'
import { SaveOutlined, FolderOpenOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { IPC_CHANNELS } from '@/constants/ipc-channels'

const { Title, Paragraph, Text } = Typography

interface AppSettings {
  ffmpegPath: string
  proxy: string
  autoBackup: boolean
  logLevel: string
}

const DEFAULT_SETTINGS: AppSettings = {
  ffmpegPath: '',
  proxy: '',
  autoBackup: true,
  logLevel: 'info'
}

export default function SettingsPage() {
  const [form] = Form.useForm()
  const [appVersion, setAppVersion] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Load settings from localStorage
    const saved = localStorage.getItem('app-settings')
    if (saved) {
      try {
        const settings = JSON.parse(saved) as AppSettings
        form.setFieldsValue(settings)
      } catch {
        form.setFieldsValue(DEFAULT_SETTINGS)
      }
    } else {
      form.setFieldsValue(DEFAULT_SETTINGS)
    }

    // Get app version
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
      message.success('设置已保存')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 16px' }}>
      <Title level={3}>设置</Title>
      <Paragraph type="secondary">配置应用参数与偏好</Paragraph>

      <Card title="应用配置" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" initialValues={DEFAULT_SETTINGS}>
          <Form.Item label="FFmpeg 路径" name="ffmpegPath" tooltip="留空则使用系统 PATH 中的 FFmpeg">
            <Input
              placeholder="例如: C:\ffmpeg\bin\ffmpeg.exe"
              suffix={<FolderOpenOutlined style={{ color: '#bfbfbf' }} />}
            />
          </Form.Item>

          <Form.Item label="网络代理" name="proxy" tooltip="HTTP 代理地址，留空则不使用代理">
            <Input placeholder="例如: http://127.0.0.1:7890" />
          </Form.Item>

          <Form.Item label="自动备份数据库" name="autoBackup" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="日志级别" name="logLevel">
            <Input.Group compact>
              <Form.Item name="logLevel" noStyle>
                <Input style={{ width: 200 }} placeholder="debug / info / warn / error" />
              </Form.Item>
            </Input.Group>
          </Form.Item>

          <Form.Item>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="应用信息">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="应用名称">VideoSync Publisher</Descriptions.Item>
          <Descriptions.Item label="版本">
            <Tag color="blue">{appVersion || '0.1.0'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="技术栈">
            <Space size={4} wrap>
              <Tag>Electron 33</Tag>
              <Tag>React 18</Tag>
              <Tag>TypeScript</Tag>
              <Tag>Ant Design 5</Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="支持平台">
            <Space size={4} wrap>
              <Tag color="red">抖音</Tag>
              <Tag color="pink">小红书</Tag>
              <Tag color="green">视频号</Tag>
              <Tag color="orange">快手</Tag>
            </Space>
          </Descriptions.Item>
        </Descriptions>

        <Divider />

        <Space direction="vertical" size={4}>
          <Text type="secondary">
            <InfoCircleOutlined /> 数据目录: {appVersion ? '(见应用 userData 目录)' : ''}
          </Text>
          <Text type="secondary">
            <InfoCircleOutlined /> 日志文件位于应用数据目录下的 logs 文件夹
          </Text>
        </Space>
      </Card>
    </div>
  )
}
