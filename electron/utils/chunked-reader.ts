import { open as fsOpen, FileHandle } from 'fs/promises'
import { statSync } from 'fs'

export interface ChunkedFileReader {
  readonly totalSize: number
  readonly chunkSize: number
  readonly totalChunks: number
  readChunk(index: number): Promise<Buffer>
  close(): Promise<void>
}

/**
 * Open a file for chunked reading.
 * Reads each chunk on-demand via fileHandle.read() — never loads the entire file into memory.
 *
 * @param filePath  Absolute path to the file
 * @param chunkSize Desired chunk size in bytes (last chunk may be smaller)
 */
export async function openChunkedReader(filePath: string, chunkSize: number): Promise<ChunkedFileReader> {
  const totalSize = statSync(filePath).size  // sync is fine — only called once at start
  const totalChunks = Math.ceil(totalSize / chunkSize)
  const handle: FileHandle = await fsOpen(filePath, 'r')

  let closed = false

  async function readChunk(index: number): Promise<Buffer> {
    if (closed) throw new Error('File reader is closed')
    const start = index * chunkSize
    const end = Math.min(start + chunkSize, totalSize)
    const length = end - start
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    if (bytesRead < length) {
      throw new Error(`Short read at chunk ${index}: expected ${length} bytes, got ${bytesRead}`)
    }
    return buffer
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    await handle.close()
  }

  return { totalSize, chunkSize, totalChunks, readChunk, close }
}
