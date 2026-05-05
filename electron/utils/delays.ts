export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function retry<T>(fn: () => Promise<T>, options: { maxAttempts?: number; delayMs?: number; backoff?: number } = {}): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = 2 } = options
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err as Error
      if (attempt < maxAttempts) {
        await delay(delayMs * Math.pow(backoff, attempt - 1))
      }
    }
  }
  throw lastError
}
