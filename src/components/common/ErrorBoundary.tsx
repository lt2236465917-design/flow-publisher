import { Component, type ReactNode } from 'react'
import { Button } from 'antd'
import { ReloadOutlined, HomeOutlined } from '@ant-design/icons'

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
        <div
          style={{
            padding: 48,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            background: '#f5f5f7',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: 'rgba(255, 59, 48, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
                fontSize: 28,
              }}
            >
              !
            </div>
            <h2
              style={{
                fontFamily: "'Sora', sans-serif",
                fontSize: 22,
                fontWeight: 600,
                color: '#1d1d1f',
                marginBottom: 8,
                letterSpacing: '-0.02em',
              }}
            >
              出现了一点问题
            </h2>
            <p
              style={{
                fontSize: 14,
                color: '#86868b',
                marginBottom: 32,
                lineHeight: 1.5,
              }}
            >
              {this.state.error?.message || '发生了未知错误'}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <Button type="primary" icon={<ReloadOutlined />} onClick={this.handleReset}>
                重试
              </Button>
              <Button icon={<HomeOutlined />} onClick={this.handleGoHome}>
                返回首页
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
