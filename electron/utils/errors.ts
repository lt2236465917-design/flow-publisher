export class PlatformError extends Error {
  constructor(
    message: string,
    public readonly platform: string,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}

export class LoginTimeoutError extends PlatformError {
  constructor(platform: string, timeoutMs: number) {
    super(`登录超时 (${timeoutMs}ms)`, platform, 'LOGIN_TIMEOUT')
    this.name = 'LoginTimeoutError'
  }
}

export class SessionExpiredError extends PlatformError {
  constructor(platform: string) {
    super('登录会话已过期', platform, 'SESSION_EXPIRED')
    this.name = 'SessionExpiredError'
  }
}

export class BrowserLaunchError extends PlatformError {
  constructor(message: string) {
    super(message, 'browser', 'BROWSER_LAUNCH_FAILED')
    this.name = 'BrowserLaunchError'
  }
}
