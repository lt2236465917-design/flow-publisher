/**
 * 中文错误消息映射表
 * 将常见错误码/关键词映射为用户友好的中文提示
 */
const ERROR_MAP: Record<string, string> = {
  // 网络相关
  ECONNREFUSED: '无法连接到服务器，请检查网络',
  ETIMEDOUT: '连接超时，请稍后重试',
  ENOTFOUND: '网络地址无法解析，请检查网络连接',
  NETWORK_ERROR: '网络异常，请检查网络连接',
  TIMEOUT: '操作超时，请稍后重试',

  // 登录相关
  LOGIN_TIMEOUT: '登录超时，请重新扫码',
  LOGIN_FAILED: '登录失败，请重试',
  SESSION_EXPIRED: '登录会话已过期，请重新登录',
  BROWSER_LAUNCH_FAILED: '浏览器启动失败，请重试',

  // 发布相关
  UPLOAD_FAILED: '视频上传失败，请重试',
  SUBMIT_FAILED: '内容提交失败，请重试',
  VIDEO_TOO_LARGE: '视频文件过大，请压缩后重试',
  VIDEO_FORMAT_UNSUPPORTED: '视频格式不支持，请使用 MP4/MOV/AVI 格式',
  VIDEO_DURATION_EXCEED: '视频时长超出平台限制',
  TITLE_REQUIRED: '请输入标题',
  PLATFORM_REQUIRED: '请至少选择一个平台',

  // 文件相关
  FILE_NOT_FOUND: '文件不存在或已被移动',
  FILE_READ_ERROR: '文件读取失败，请检查文件路径',
  FILE_PATH_INVALID: '文件路径包含无效字符',

  // 数据库相关
  DB_ERROR: '数据存储异常，请重启应用',
  DB_NOT_FOUND: '数据库文件异常，请重启应用',

  // 浏览器相关
  BROWSER_CLOSED: '浏览器已关闭',
  PAGE_NAVIGATE_FAILED: '页面加载失败，请检查网络',
  ELEMENT_NOT_FOUND: '页面元素未找到，可能平台已更新',
}

/**
 * 将原始错误信息转为中文提示
 */
export function toChineseMessage(error: unknown): string {
  if (!error) return '未知错误'

  const raw = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
  const upper = raw.toUpperCase()

  for (const [key, msg] of Object.entries(ERROR_MAP)) {
    if (upper.includes(key.toUpperCase())) {
      return msg
    }
  }

  // 如果已经是中文，直接返回
  if (/[一-鿿]/.test(raw)) return raw

  return '操作失败，请稍后重试'
}

/**
 * 获取错误的简短描述（用于日志）
 */
export function getErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}
