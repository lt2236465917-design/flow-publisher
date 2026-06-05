import { openChunkedReader, type ChunkedFileReader } from './chunked-reader'
import { retry } from './delays'
import { logger } from './logger'

export interface UploadProgress {
  percent: number
  stage: string
}

export interface ChunkUploadResult {
  /** Per-chunk identifier (usually the ETag or CRC32 from the server) */
  etag: string
  /** 1-based part number */
  partNumber: number
}

export interface ChunkedUploaderOptions {
  filePath: string
  chunkSize: number
  concurrency: number
  maxRetries: number
  /** Called for each chunk — platform-specific HTTP upload logic */
  uploadChunk: (chunk: Buffer, partNumber: number) => Promise<string>
  /** Called after all chunks complete — platform-specific finalization */
  finalize: (parts: Array<{ partNumber: number; etag: string }>) => Promise<string>
  onProgress?: (p: UploadProgress) => void
  /** Base progress percentage (0-100) where chunk upload begins */
  progressStart?: number
  /** Progress range for chunk upload phase (e.g. 70 means chunks span start → start+70%) */
  progressRange?: number
}

/**
 * Shared chunked upload orchestrator (M19 fix).
 *
 * Handles: file validation, chunked reading, concurrency control, per-chunk retry,
 * progress reporting, and finalization. Each adapter only provides its platform-specific
 * `uploadChunk` (HTTP call) and `finalize` (completion call).
 */
export async function chunkedUpload(options: ChunkedUploaderOptions): Promise<string> {
  const {
    filePath, chunkSize, concurrency, maxRetries,
    uploadChunk, finalize, onProgress,
    progressStart = 0, progressRange = 70
  } = options

  const reader = await openChunkedReader(filePath, chunkSize)
  const totalChunks = reader.totalChunks

  const parts = new Map<number, string>() // partNumber → etag
  let completed = 0
  let firstError: Error | null = null

  try {
    const uploadOne = async (): Promise<void> => {
      let idx: number
      // eslint-disable-next-line no-cond-assign
      while ((idx = nextIndex++) < totalChunks && !firstError) {
        const partNumber = idx + 1
        try {
          const chunk = await reader.readChunk(idx)
          const etag = await retry(
            () => uploadChunk(chunk, partNumber),
            { maxAttempts: maxRetries, delayMs: 2000, backoff: 2 }
          )
          parts.set(partNumber, etag)
          completed++
          const pct = progressStart + Math.round((completed / totalChunks) * progressRange)
          onProgress?.({ percent: pct, stage: `上传中 ${completed}/${totalChunks}` })
        } catch (err: any) {
          firstError = firstError || err
          return
        }
      }
    }

    let nextIndex = 0
    const workers = Array.from({ length: Math.min(concurrency, totalChunks) }, () => uploadOne())
    await Promise.all(workers)

    if (firstError) throw new Error(`分块上传失败: ${firstError.message}`)
    if (parts.size !== totalChunks) throw new Error(`上传不完整: ${parts.size}/${totalChunks}`)

    // Build ordered part array
    const orderedParts: Array<{ partNumber: number; etag: string }> = []
    for (let i = 1; i <= totalChunks; i++) {
      const etag = parts.get(i)
      if (etag) orderedParts.push({ partNumber: i, etag })
    }

    logger.info(`[chunked-uploader] All ${totalChunks} chunks uploaded, finalizing...`)
    return await retry(
      () => finalize(orderedParts),
      { maxAttempts: 3, delayMs: 2000, backoff: 2 }
    )
  } finally {
    await reader.close()
  }
}
