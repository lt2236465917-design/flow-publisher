import ffmpeg from 'fluent-ffmpeg'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import { logger } from '../../utils/logger'

interface VideoProbe {
  filePath: string
  fileName: string
  fileSize: number
  duration: number
  width: number
  height: number
  format: string
  bitrate: number
  fps: number
}

function unpackedBinaryPath(binaryPath: string): string {
  return app.isPackaged ? binaryPath.replace('app.asar', 'app.asar.unpacked') : binaryPath
}

function findFfmpegBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const exe = process.platform === 'win32' ? `${name}.exe` : name

  // 1. Check bundled static binaries (if installed)
  try {
    if (name === 'ffmpeg') {
      const staticPath = require('ffmpeg-static')
      const target = staticPath ? unpackedBinaryPath(staticPath) : null
      if (target && existsSync(target)) return target
    } else {
      const staticProbe = require('ffprobe-static')
      const staticPath = typeof staticProbe === 'string' ? staticProbe : staticProbe?.path
      const target = staticPath ? unpackedBinaryPath(staticPath) : null
      if (target && existsSync(target)) return target
    }
  } catch {}

  // 2. Check PATH environment
  const pathDirs = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')
  for (const dir of pathDirs) {
    const candidate = join(dir, exe)
    if (existsSync(candidate)) return candidate
  }

  // 3. Check common Windows install locations
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || ''
    const candidates = [
      // winget / Gyan.FFmpeg
      join(localAppData, 'Microsoft', 'WinGet', 'Packages'),
      // manual install common paths
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin',
      'C:\\Program Files (x86)\\ffmpeg\\bin'
    ]

    for (const base of candidates) {
      if (!existsSync(base)) continue

      // For winget, the binary is nested in a subdirectory
      if (base.includes('WinGet')) {
        try {
          const entries = readdirSync(base)
          for (const entry of entries) {
            if (entry.toLowerCase().includes('ffmpeg')) {
              const binDir = join(base, entry)
              // Search recursively for bin/ffmpeg.exe
              const found = findInDir(binDir, exe, 3)
              if (found) return found
            }
          }
        } catch {}
      } else {
        const candidate = join(base, exe)
        if (existsSync(candidate)) return candidate
      }
    }
  }

  return null
}

function findInDir(dir: string, filename: string, maxDepth: number): string | null {
  if (maxDepth <= 0 || !existsSync(dir)) return null
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const full = join(dir, entry)
      if (entry.toLowerCase() === filename.toLowerCase()) return full
      try {
        if (statSync(full).isDirectory()) {
          const found = findInDir(full, filename, maxDepth - 1)
          if (found) return found
        }
      } catch {}
    }
  } catch {}
  return null
}

// Resolve ffmpeg paths once at module load
const FFMPEG_PATH = findFfmpegBinary('ffmpeg')
const FFPROBE_PATH = findFfmpegBinary('ffprobe')

if (FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(FFMPEG_PATH)
  logger.info(`[FFmpegService] ffmpeg found at: ${FFMPEG_PATH}`)
} else {
  logger.warn('[FFmpegService] ffmpeg not found! Video probe and frame extraction will fail.')
}

if (FFPROBE_PATH) {
  ffmpeg.setFfprobePath(FFPROBE_PATH)
  logger.info(`[FFmpegService] ffprobe found at: ${FFPROBE_PATH}`)
} else {
  logger.warn('[FFmpegService] ffprobe not found!')
}

export class FFmpegService {
  private getFramesDir(): string {
    const dir = join(app.getPath('temp'), 'videosync-frames')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  isAvailable(): boolean {
    return !!FFMPEG_PATH && !!FFPROBE_PATH
  }

  probeVideo(filePath: string): Promise<VideoProbe> {
    if (!existsSync(filePath)) return Promise.reject(new Error(`文件不存在: ${filePath}`))
    if (!FFPROBE_PATH) return Promise.reject(new Error('ffprobe 未安装，请先安装 ffmpeg'))

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(new Error(`ffprobe 失败: ${err.message}`))

        const videoStream = metadata.streams.find((s) => s.codec_type === 'video')
        if (!videoStream) return reject(new Error('无法解析视频流'))

        const fileName = basename(filePath)
        const fileSize = metadata.format.size || 0
        const duration = metadata.format.duration || 0
        const width = videoStream.width || 0
        const height = videoStream.height || 0
        const bitrate = Number(metadata.format.bit_rate || 0)
        const ext = extname(fileName).replace('.', '').toLowerCase()

        let fps = 0
        if (videoStream.r_frame_rate) {
          const parts = String(videoStream.r_frame_rate).split('/')
          if (parts.length === 2 && Number(parts[1]) !== 0) {
            fps = Math.round((Number(parts[0]) / Number(parts[1])) * 100) / 100
          }
        }

        resolve({ filePath, fileName, fileSize, duration, width, height, format: ext, bitrate, fps })
      })
    })
  }

  extractFrames(filePath: string, count = 8): Promise<{ timestamp: number; dataUrl: string }[]> {
    if (!existsSync(filePath)) return Promise.reject(new Error(`文件不存在: ${filePath}`))
    if (!FFMPEG_PATH) return Promise.reject(new Error('ffmpeg 未安装，请先安装 ffmpeg'))

    return new Promise(async (resolve, reject) => {
      try {
        const probe = await this.probeVideo(filePath)
        const duration = probe.duration
        if (duration <= 0) return reject(new Error('无法获取视频时长'))

        const framesDir = this.getFramesDir()
        const sessionDir = join(framesDir, `session-${Date.now()}`)
        mkdirSync(sessionDir, { recursive: true })

        const timestamps: number[] = []
        for (let i = 0; i < count; i++) {
          timestamps.push(Math.round((duration / (count + 1)) * (i + 1) * 100) / 100)
        }

        const frames: { timestamp: number; dataUrl: string }[] = []
        let completed = 0
        let hasError = false

        for (let i = 0; i < timestamps.length; i++) {
          const t = timestamps[i]
          const outPath = join(sessionDir, `frame-${i}.jpg`)

          ffmpeg(filePath)
            .seekInput(t)
            .frames(1)
            .outputOptions('-q:v', '3')
            .save(outPath)
            .on('end', () => {
              if (hasError) return
              try {
                if (existsSync(outPath)) {
                  const buf = readFileSync(outPath)
                  frames[i] = {
                    timestamp: t,
                    dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`
                  }
                }
              } catch {}
              completed++
              if (completed === timestamps.length) {
                resolve(frames.filter(Boolean))
              }
            })
            .on('error', (e) => {
              if (!hasError) {
                logger.warn(`Failed to extract frame at ${t}s:`, e.message)
                completed++
                if (completed === timestamps.length) {
                  resolve(frames.filter(Boolean))
                }
              }
            })
        }
      } catch (e) {
        reject(e)
      }
    })
  }
}

export const ffmpegService = new FFmpegService()
