import axios from 'axios'
import FormData from 'form-data'
import { createReadStream, existsSync, statSync } from 'fs'
import { basename, extname } from 'path'
import type { UploadProgress, UploadResult } from '../platform-adapters/IPlatformAdapter'
import type { SubmitResult } from '../../../shared/types/analytics'
import { openChunkedReader } from '../../utils/chunked-reader'
import { logger } from '../../utils/logger'
import { requireSecureUploadEndpoint } from '../../security/secure-transport'

const START_UPLOAD_URL = 'https://open.kuaishou.com/openapi/photo/start_upload'
const PUBLISH_URL = 'https://open.kuaishou.com/openapi/photo/publish'
const DIRECT_UPLOAD_LIMIT = 10 * 1024 * 1024
const FRAGMENT_SIZE = 8 * 1024 * 1024

interface KuaishouStartUploadResponse {
  result: number
  upload_token?: string
  endpoint?: string
  error_msg?: string
  message?: string
}

interface KuaishouPublishResponse {
  result: number
  video_info?: {
    photo_id?: string
    play_url?: string
    cover?: string
    caption?: string
    pending?: boolean
  }
  error_msg?: string
  message?: string
}

interface KuaishouOpenApiConfig {
  appId: string
  accessToken: string
}

export class KuaishouOpenApiPublisher {
  isConfigured(): boolean {
    return !!this.getConfig()
  }

  async uploadVideo(
    filePath: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<UploadResult> {
    const config = this.requireConfig()
    const start = await this.startUpload(config)
    const uploadToken = start.upload_token
    const endpoint = start.endpoint
    if (!uploadToken || !endpoint) {
      throw new Error(`快手官方上传初始化失败：缺少 upload_token 或 endpoint`)
    }

    const size = statSync(filePath).size
    if (size <= DIRECT_UPLOAD_LIMIT) {
      await this.uploadDirect(endpoint, uploadToken, filePath)
      onProgress?.({ percent: 80, stage: '快手官方 OpenAPI 上传完成' })
    } else {
      await this.uploadFragments(endpoint, uploadToken, filePath, onProgress)
    }

    return {
      videoId: uploadToken,
      meta: {
        channel: 'kuaishou-openapi',
        uploadToken,
        endpoint
      }
    }
  }

  async publish(params: {
    uploadToken: string
    caption: string
    coverPath?: string
  }): Promise<SubmitResult> {
    const config = this.requireConfig()
    if (!params.coverPath || !existsSync(params.coverPath)) {
      throw new Error('快手官方 OpenAPI 发布需要封面图，请先选择或生成封面')
    }

    const form = new FormData()
    form.append('caption', params.caption)
    form.append('cover', createReadStream(params.coverPath), {
      filename: basename(params.coverPath),
      contentType: this.getImageContentType(params.coverPath)
    })

    const url = new URL(PUBLISH_URL)
    url.searchParams.set('access_token', config.accessToken)
    url.searchParams.set('app_id', config.appId)
    url.searchParams.set('upload_token', params.uploadToken)

    const response = await axios.post<KuaishouPublishResponse>(
      url.toString(),
      form,
      {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        timeout: 120_000,
        validateStatus: () => true
      }
    )

    logger.info(`[kuaishou-openapi] publish response: ${JSON.stringify(response.data).substring(0, 500)}`)
    if (response.data?.result !== 1) {
      throw new Error(`快手官方 OpenAPI 发布失败：${response.data?.error_msg || response.data?.message || `result=${response.data?.result}`}`)
    }

    const photoId = response.data.video_info?.photo_id
    return {
      contentId: photoId,
      publishUrl: photoId ? `https://www.kuaishou.com/short-video/${photoId}` : response.data.video_info?.play_url
    }
  }

  private async startUpload(config: KuaishouOpenApiConfig): Promise<KuaishouStartUploadResponse> {
    const url = new URL(START_UPLOAD_URL)
    url.searchParams.set('access_token', config.accessToken)
    url.searchParams.set('app_id', config.appId)

    const response = await axios.post<KuaishouStartUploadResponse>(
      url.toString(),
      undefined,
      {
        timeout: 60_000,
        validateStatus: () => true
      }
    )

    logger.info(`[kuaishou-openapi] start_upload response: ${JSON.stringify(response.data).substring(0, 500)}`)
    if (response.data?.result !== 1) {
      throw new Error(`快手官方 OpenAPI 发起上传失败：${response.data?.error_msg || response.data?.message || `result=${response.data?.result}`}`)
    }
    return response.data
  }

  private async uploadDirect(endpoint: string, uploadToken: string, filePath: string): Promise<void> {
    const baseUrl = requireSecureUploadEndpoint(endpoint)
    const url = `${baseUrl}/api/upload?upload_token=${encodeURIComponent(uploadToken)}`
    const response = await axios.post<{ result: number; error_msg?: string; message?: string }>(
      url,
      createReadStream(filePath),
      {
        headers: { 'Content-Type': this.getVideoContentType(filePath) },
        maxBodyLength: Infinity,
        timeout: 10 * 60_000,
        validateStatus: () => true
      }
    )
    logger.info(`[kuaishou-openapi] direct upload response: ${JSON.stringify(response.data).substring(0, 500)}`)
    if (response.data?.result !== 1) {
      throw new Error(`快手官方 OpenAPI 视频上传失败：${response.data?.error_msg || response.data?.message || `result=${response.data?.result}`}`)
    }
  }

  private async uploadFragments(
    endpoint: string,
    uploadToken: string,
    filePath: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<void> {
    const baseUrl = requireSecureUploadEndpoint(endpoint)
    const reader = await openChunkedReader(filePath, FRAGMENT_SIZE)
    try {
      for (let i = 0; i < reader.totalChunks; i++) {
        const chunk = await reader.readChunk(i)
        const url = `${baseUrl}/api/upload/fragment?upload_token=${encodeURIComponent(uploadToken)}&fragment_id=${i}`
        const response = await axios.post<{ result: number; error_msg?: string; message?: string }>(
          url,
          chunk,
          {
            headers: { 'Content-Type': this.getVideoContentType(filePath) },
            maxBodyLength: Infinity,
            timeout: 10 * 60_000,
            validateStatus: () => true
          }
        )
        if (response.data?.result !== 1) {
          throw new Error(`快手官方 OpenAPI 分片上传失败：${response.data?.error_msg || response.data?.message || `result=${response.data?.result}`}`)
        }
        onProgress?.({
          percent: Math.min(80, Math.round(((i + 1) / reader.totalChunks) * 80)),
          stage: `快手官方 OpenAPI 上传中 ${i + 1}/${reader.totalChunks}`
        })
      }

      const completeUrl = `${baseUrl}/api/upload/complete?upload_token=${encodeURIComponent(uploadToken)}&fragment_count=${reader.totalChunks}`
      const completeResponse = await axios.post<{ result: number; error_msg?: string; message?: string }>(
        completeUrl,
        undefined,
        {
          timeout: 60_000,
          validateStatus: () => true
        }
      )
      logger.info(`[kuaishou-openapi] complete upload response: ${JSON.stringify(completeResponse.data).substring(0, 500)}`)
      if (completeResponse.data?.result !== 1) {
        throw new Error(`快手官方 OpenAPI 完成上传失败：${completeResponse.data?.error_msg || completeResponse.data?.message || `result=${completeResponse.data?.result}`}`)
      }
    } finally {
      await reader.close()
    }
  }

  private requireConfig(): KuaishouOpenApiConfig {
    const config = this.getConfig()
    if (!config) {
      throw new Error('未配置快手官方 OpenAPI：请设置 FLOW_PUBLISHER_KUAISHOU_OPENAPI_APP_ID 和 FLOW_PUBLISHER_KUAISHOU_OPENAPI_ACCESS_TOKEN')
    }
    return config
  }

  private getConfig(): KuaishouOpenApiConfig | null {
    const appId = process.env.FLOW_PUBLISHER_KUAISHOU_OPENAPI_APP_ID?.trim()
    const accessToken = process.env.FLOW_PUBLISHER_KUAISHOU_OPENAPI_ACCESS_TOKEN?.trim()
    if (!appId || !accessToken) return null
    return { appId, accessToken }
  }

  private getVideoContentType(filePath: string): string {
    const ext = extname(filePath).toLowerCase()
    if (ext === '.mov') return 'video/quicktime'
    if (ext === '.webm') return 'video/webm'
    return 'video/mp4'
  }

  private getImageContentType(filePath: string): string {
    const ext = extname(filePath).toLowerCase()
    if (ext === '.png') return 'image/png'
    if (ext === '.webp') return 'image/webp'
    return 'image/jpeg'
  }
}
