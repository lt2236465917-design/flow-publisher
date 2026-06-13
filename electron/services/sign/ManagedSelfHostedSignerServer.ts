import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { getSignService } from './SignService'
import { getSelfHostedSignerUrl, shouldStartManagedSelfHostedSigner } from './SignPolicy'
import { logger } from '../../utils/logger'

const MAX_REQUEST_BYTES = 5 * 1024 * 1024

interface SignRequestBody {
  platform?: unknown
  cookie?: unknown
  data?: unknown
  body?: unknown
  url?: unknown
  accountId?: unknown
}

class ManagedSelfHostedSignerServer {
  private server: Server | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private eaddrInUseLogged = false

  async start(): Promise<void> {
    if (this.server || !shouldStartManagedSelfHostedSigner()) return

    const signerUrl = getSelfHostedSignerUrl()
    if (!signerUrl) return

    const endpoint = new URL(signerUrl)
    const host = endpoint.hostname || '127.0.0.1'
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      logger.warn(`[sign-server] Refusing to start managed signer on non-loopback host: ${host}`)
      return
    }

    const port = Number(endpoint.port || '17321')
    const listenHost = host === 'localhost' ? '127.0.0.1' : host

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        logger.error('[sign-server] Request failed:', err)
        this.sendJson(res, 500, { signature: '', error: String(err) })
      })
    })

    await new Promise<void>((resolve) => {
      const server = this.server!
      server.once('error', (err: NodeJS.ErrnoException) => {
        this.server = null
        if (err.code === 'EADDRINUSE') {
          if (!this.eaddrInUseLogged) {
            logger.info(`[sign-server] Port ${port} is already in use; will retry managed signer startup in case the external signer exits`)
            this.eaddrInUseLogged = true
          }
          this.scheduleRetry()
        } else {
          logger.warn(`[sign-server] Failed to start managed signer on ${listenHost}:${port}:`, err)
        }
        resolve()
      })
      server.listen(port, listenHost, () => {
        this.eaddrInUseLogged = false
        logger.info(`[sign-server] Managed self-hosted signer listening on http://${listenHost}:${port}/sign`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    const server = this.server
    if (!server) return
    this.server = null

    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) logger.warn('[sign-server] Error while stopping managed signer:', err)
        resolve()
      })
    })
  }

  private scheduleRetry(): void {
    if (this.retryTimer || !shouldStartManagedSelfHostedSigner()) return

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.start().catch((err) => logger.warn('[sign-server] Managed signer retry failed:', err))
    }, 2_000)
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method || 'GET'
    const path = new URL(req.url || '/', 'http://127.0.0.1').pathname

    if (method === 'GET' && path === '/health') {
      this.sendJson(res, 200, { ok: true })
      return
    }

    if (method !== 'POST' || path !== '/sign') {
      this.sendJson(res, 404, { signature: '', error: 'not found' })
      return
    }

    const payload = await this.readJson(req)
    const platform = typeof payload.platform === 'string' ? payload.platform : ''
    const cookie = typeof payload.cookie === 'string' ? payload.cookie : ''
    const data = typeof payload.data === 'string'
      ? payload.data
      : typeof payload.url === 'string'
        ? payload.url
        : JSON.stringify(payload.data ?? '')
    const body = typeof payload.body === 'string' ? payload.body : undefined
    const accountId = typeof payload.accountId === 'string' ? payload.accountId : undefined

    if (!platform || !cookie || !data) {
      this.sendJson(res, 400, { signature: '', error: 'platform, cookie and data are required' })
      return
    }

    const signature = await getSignService().getBuiltinLocalSignature(platform, cookie, data, body, accountId)
    if (!signature) {
      this.sendJson(res, 502, { signature: '', error: 'managed signer failed to generate signature' })
      return
    }

    this.sendJson(res, 200, { signature })
  }

  private readJson(req: IncomingMessage): Promise<SignRequestBody> {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks: Buffer[] = []

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_REQUEST_BYTES) {
          reject(new Error('sign request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })

      req.on('error', reject)
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve(raw ? JSON.parse(raw) as SignRequestBody : {})
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  private sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    res.end(JSON.stringify(body))
  }
}

let managedSignerServer: ManagedSelfHostedSignerServer | null = null

export function getManagedSelfHostedSignerServer(): ManagedSelfHostedSignerServer {
  if (!managedSignerServer) {
    managedSignerServer = new ManagedSelfHostedSignerServer()
  }
  return managedSignerServer
}
