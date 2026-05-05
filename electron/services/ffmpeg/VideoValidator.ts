import type { VideoConstraints } from '../../platform-adapters/IPlatformAdapter'

interface ProbeResult {
  fileSize: number
  duration: number
  format: string
}

const PLATFORM_CONSTRAINTS: Record<string, VideoConstraints> = {
  douyin: {
    maxFileSizeMB: 4096,
    maxDurationSec: 900,
    supportedFormats: ['mp4', 'mov', 'avi', 'flv', 'mkv', 'wmv']
  },
  xiaohongshu: {
    maxFileSizeMB: 500,
    maxDurationSec: 900,
    supportedFormats: ['mp4', 'mov', 'avi']
  },
  'wechat-channels': {
    maxFileSizeMB: 500,
    maxDurationSec: 1800,
    supportedFormats: ['mp4', 'mov']
  },
  kuaishou: {
    maxFileSizeMB: 500,
    maxDurationSec: 600,
    supportedFormats: ['mp4', 'mov', 'avi', 'flv']
  }
}

export function getConstraintsForPlatform(platformId: string): VideoConstraints | null {
  return PLATFORM_CONSTRAINTS[platformId] || null
}

export function validateVideo(
  probe: ProbeResult,
  platformId: string
): { valid: boolean; errors: string[] } {
  const constraints = PLATFORM_CONSTRAINTS[platformId]
  if (!constraints) return { valid: true, errors: [] }

  const errors: string[] = []

  const fileSizeMB = probe.fileSize / (1024 * 1024)
  if (fileSizeMB > constraints.maxFileSizeMB) {
    errors.push(`文件大小 ${fileSizeMB.toFixed(1)}MB 超过限制 ${constraints.maxFileSizeMB}MB`)
  }

  if (probe.duration > constraints.maxDurationSec) {
    const min = Math.floor(probe.duration / 60)
    const sec = Math.floor(probe.duration % 60)
    errors.push(`视频时长 ${min}分${sec}秒 超过限制 ${Math.floor(constraints.maxDurationSec / 60)}分钟`)
  }

  const ext = probe.format.toLowerCase()
  if (!constraints.supportedFormats.includes(ext)) {
    errors.push(`格式 .${ext} 不受支持，支持的格式: ${constraints.supportedFormats.join(', ')}`)
  }

  return { valid: errors.length === 0, errors }
}
