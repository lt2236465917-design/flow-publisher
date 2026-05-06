import { Component, type ReactNode } from 'react'
import { Result, Button, Typography, Collapse } from 'antd'
import { ReloadOutlined, HomeOutlined } from '@ant-design/icons'

const { Text } = Typography

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo })
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  handleGoHome = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    window.location.hash = '#/account'
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{ padding: 48, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
          <Result
            status="error"
            title="应用出错了"
            subTitle={this.state.error?.message || '发生了未知错误'}
            extra={[
              <Button key="retry" type="primary" icon={<ReloadOutlined />} onClick={this.handleReset}>
                重试
              </Button>,
              <Button key="home" icon={<HomeOutlined />} onClick={this.handleGoHome}>
                返回首页
              </Button>
            ]}
          >
            {this.state.errorInfo && (
              <Collapse
                ghost
                items={[{
                  key: '1',
                  label: '错误详情（点击展开）',
                  children: (
                    <Text code style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 300, display: 'block', overflow: 'auto' }}>
                      {this.state.error?.stack}
                    </Text>
                  )
                }]}
              />
            )}
          </Result>
        </div>
      )
    }
    return this.props.children
  }
}
