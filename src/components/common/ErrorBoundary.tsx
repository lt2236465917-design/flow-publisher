import { Component, type ReactNode } from 'react'
import { Result, Button } from 'antd'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="应用出错了"
          subTitle={this.state.error?.message}
          extra={
            <Button type="primary" onClick={this.handleReset}>
              重试
            </Button>
          }
        />
      )
    }
    return this.props.children
  }
}
