import { createHash } from 'crypto'
import { createReadStream } from 'fs'

/**
 * Compute the MD5 hex digest of a file.
 * Uses streaming reads — safe for large files.
 */
export function computeFileMd5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const stream = createReadStream(filePath)
    stream.on('data', (data: Buffer) => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
