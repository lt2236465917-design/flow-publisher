# Confirmed Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the confirmed transport, Electron boundary, file-access, publish-validation, scheduled-idempotency, listener-lifecycle, credential-artifact, and logging defects without introducing any UI publishing path.

**Architecture:** Add small pure policy modules for URL/IPC and file authorization, then call them at existing Electron and IPC boundaries. Persist a stable scheduled-task/platform link on publish records so upload retries reuse one record and final submission is never generically retried. Keep platform adapters API/HTTP-only and make all remote transport fail closed on insecure URLs or certificates.

**Tech Stack:** Electron 33, TypeScript 5.7, React 18, Vitest 3, sql.js, Axios, Node HTTPS.

---

## File Map

- Create `electron/security/navigation-policy.ts`: trusted renderer, platform-window, and remote HTTPS URL rules.
- Create `electron/security/navigation-policy.test.ts`: policy regression tests.
- Create `electron/security/ipc-guard.ts`: verify privileged IPC calls originate from the main renderer frame.
- Create `electron/security/ipc-guard.test.ts`: sender validation tests.
- Create `electron/security/file-access-policy.ts`: canonical authorization registry and app-owned-root checks.
- Create `electron/security/file-access-policy.test.ts`: path traversal, sibling-prefix, authorization, and size tests.
- Create `electron/security/secure-transport.ts`: HTTPS endpoint validation and secure-agent construction.
- Create `electron/security/secure-transport.test.ts`: HTTP rejection and HTTPS acceptance tests.
- Create `electron/utils/data-url.ts`: bounded image data-URL parsing.
- Create `electron/utils/data-url.test.ts`: MIME and decoded-size regression tests.
- Create `electron/services/database/migrations/008_scheduled_publish_source.ts`: `source_task_id` migration and unique index.
- Create `electron/services/scheduler/scheduled-publish-policy.ts`: pure resume/submit decision rules.
- Create `electron/services/scheduler/scheduled-publish-policy.test.ts`: final-submit-at-most-once tests.
- Modify `electron/main.ts`: main-window restrictions, protocol authorization, IPC guard for app version.
- Modify `electron/preload.ts`: correct listener unsubscribe and authorize drag/drop paths.
- Modify `src/constants/ipc-channels.ts`: add file authorization channel.
- Modify `src/types/ipc.types.ts` and/or `src/vite-env.d.ts`: expose the new typed bridge method.
- Modify `src/components/publish/VideoDropZone.tsx`: register dropped paths before use.
- Modify `electron/ipc/*.ipc.ts`: guard senders and validate arguments/relationships.
- Modify `electron/services/browser/ElectronLoginWindow.ts`: restrict remote navigation/windows/permissions.
- Modify `electron/services/browser/BrowserManager.ts`: restore TLS checking.
- Modify `electron/services/sign/SignService.ts`: restrict signer windows and retain API-request-only behavior.
- Modify `electron/services/http/HttpClient.ts`: remove permissive HTTPS agent and redact sensitive request bodies.
- Modify four platform adapters: remove `rejectUnauthorized: false` and sensitive token/body logging.
- Modify `electron/services/openapi/KuaishouOpenApiPublisher.ts`: require HTTPS upload endpoints.
- Modify `electron/services/location/IPLocationService.ts`: HTTPS geolocation endpoint.
- Modify database index/repositories/schema: register migration 008 and scheduled-record lookup/update methods.
- Modify `electron/services/scheduler/TaskQueue.ts`: reuse one record, retry upload only, submit once.
- Modify `electron/ipc/account.ipc.ts`: remove destructive duplicate-account cleanup.
- Delete `captured-submit-payload.json`; update `.gitignore`.

### Task 1: Secure URL and IPC Policies

**Files:**
- Create: `electron/security/navigation-policy.ts`
- Create: `electron/security/navigation-policy.test.ts`
- Create: `electron/security/ipc-guard.ts`
- Create: `electron/security/ipc-guard.test.ts`

- [ ] **Step 1: Write failing navigation-policy tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  isTrustedMainRendererUrl,
  isAllowedPlatformNavigation,
  isSecureRemoteUrl
} from './navigation-policy'

describe('navigation policy', () => {
  it('accepts only the configured dev renderer origin', () => {
    expect(isTrustedMainRendererUrl('http://localhost:5173/publish', 'http://localhost:5173')).toBe(true)
    expect(isTrustedMainRendererUrl('http://localhost.attacker.test:5173', 'http://localhost:5173')).toBe(false)
  })

  it('accepts packaged renderer files only under the renderer root', () => {
    expect(isTrustedMainRendererUrl(
      'file:///app/out/renderer/index.html',
      undefined,
      '/app/out/renderer'
    )).toBe(true)
    expect(isTrustedMainRendererUrl(
      'file:///Users/test/.ssh/id_rsa',
      undefined,
      '/app/out/renderer'
    )).toBe(false)
  })

  it('allows platform navigation only to HTTPS host suffixes', () => {
    expect(isAllowedPlatformNavigation(
      'https://creator.douyin.com/creator-micro',
      ['douyin.com']
    )).toBe(true)
    expect(isAllowedPlatformNavigation(
      'https://douyin.com.attacker.test/',
      ['douyin.com']
    )).toBe(false)
    expect(isAllowedPlatformNavigation('http://creator.douyin.com/', ['douyin.com'])).toBe(false)
  })

  it('allows HTTP only for loopback signer endpoints', () => {
    expect(isSecureRemoteUrl('https://upload.example.com/a')).toBe(true)
    expect(isSecureRemoteUrl('http://127.0.0.1:17321/sign', { allowLoopbackHttp: true })).toBe(true)
    expect(isSecureRemoteUrl('http://upload.example.com/a')).toBe(false)
  })
})
```

- [ ] **Step 2: Write failing IPC-guard tests**

```ts
import { describe, expect, it } from 'vitest'
import { isTrustedIpcSender } from './ipc-guard'

describe('IPC sender guard', () => {
  it('requires the top-level trusted renderer frame', () => {
    expect(isTrustedIpcSender({
      senderUrl: 'file:///app/out/renderer/index.html',
      topFrameUrl: 'file:///app/out/renderer/index.html',
      expectedWindowId: 7,
      senderWindowId: 7,
      rendererRoot: '/app/out/renderer'
    })).toBe(true)
  })

  it('rejects iframe and navigated sender origins', () => {
    expect(isTrustedIpcSender({
      senderUrl: 'https://attacker.test/frame',
      topFrameUrl: 'file:///app/out/renderer/index.html',
      expectedWindowId: 7,
      senderWindowId: 7,
      rendererRoot: '/app/out/renderer'
    })).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx vitest run electron/security/navigation-policy.test.ts electron/security/ipc-guard.test.ts
```

Expected: FAIL because both policy modules are missing.

- [ ] **Step 4: Implement minimal pure policies**

```ts
// electron/security/navigation-policy.ts
import { resolve, sep } from 'path'
import { fileURLToPath } from 'url'

function hostMatches(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase()
  const allowed = suffix.toLowerCase()
  return host === allowed || host.endsWith(`.${allowed}`)
}

export function isLoopbackHost(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname.toLowerCase())
}

export function isSecureRemoteUrl(
  value: string,
  options: { allowLoopbackHttp?: boolean } = {}
): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ||
      (options.allowLoopbackHttp === true && url.protocol === 'http:' && isLoopbackHost(url.hostname))
  } catch {
    return false
  }
}

export function isAllowedPlatformNavigation(value: string, hostSuffixes: string[]): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && hostSuffixes.some((suffix) => hostMatches(url.hostname, suffix))
  } catch {
    return false
  }
}

export function isTrustedMainRendererUrl(
  value: string,
  devRendererUrl?: string,
  rendererRoot?: string
): boolean {
  try {
    const url = new URL(value)
    if (devRendererUrl) return url.origin === new URL(devRendererUrl).origin
    if (url.protocol !== 'file:' || !rendererRoot) return false
    const candidate = resolve(fileURLToPath(url))
    const root = resolve(rendererRoot)
    return candidate === root || candidate.startsWith(`${root}${sep}`)
  } catch {
    return false
  }
}
```

```ts
// electron/security/ipc-guard.ts
import { isTrustedMainRendererUrl } from './navigation-policy'

export interface IpcSenderDescriptor {
  senderUrl: string
  topFrameUrl: string
  expectedWindowId: number
  senderWindowId: number | null
  devRendererUrl?: string
  rendererRoot?: string
}

export function isTrustedIpcSender(input: IpcSenderDescriptor): boolean {
  return input.senderWindowId === input.expectedWindowId &&
    input.senderUrl === input.topFrameUrl &&
    isTrustedMainRendererUrl(input.senderUrl, input.devRendererUrl, input.rendererRoot)
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
npx vitest run electron/security/navigation-policy.test.ts electron/security/ipc-guard.test.ts
```

Expected: both test files PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/security/navigation-policy.ts electron/security/navigation-policy.test.ts electron/security/ipc-guard.ts electron/security/ipc-guard.test.ts
git commit -m "test: define Electron security policies"
```

### Task 2: Apply Electron Navigation, Permission, and IPC Guards

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/ipc/account.ipc.ts`
- Modify: `electron/ipc/analytics.ipc.ts`
- Modify: `electron/ipc/file-dialog.ipc.ts`
- Modify: `electron/ipc/publish.ipc.ts`
- Modify: `electron/ipc/scheduler.ipc.ts`
- Modify: `electron/services/browser/ElectronLoginWindow.ts`
- Modify: `electron/services/sign/SignService.ts`

- [ ] **Step 1: Add a failing integration-shaped guard test**

Extend `electron/security/ipc-guard.test.ts`:

```ts
it('rejects a trusted URL sent from a different BrowserWindow', () => {
  expect(isTrustedIpcSender({
    senderUrl: 'file:///app/out/renderer/index.html',
    topFrameUrl: 'file:///app/out/renderer/index.html',
    expectedWindowId: 7,
    senderWindowId: 9,
    rendererRoot: '/app/out/renderer'
  })).toBe(false)
})
```

- [ ] **Step 2: Run the test and verify RED or missing integration behavior**

Run:

```bash
npx vitest run electron/security/ipc-guard.test.ts
```

Expected: the pure test passes; then verify existing IPC files have no guard calls:

```bash
rg -n "assertTrustedIpcSender" electron/ipc electron/main.ts
```

Expected: no matches.

- [ ] **Step 3: Add the Electron adapter guard**

Add to `electron/security/ipc-guard.ts`:

```ts
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  options: { devRendererUrl?: string; rendererRoot?: string }
): void {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  const senderUrl = event.senderFrame.url
  const topFrameUrl = event.senderFrame.top?.url || ''
  if (!isTrustedIpcSender({
    senderUrl,
    topFrameUrl,
    expectedWindowId: mainWindow.id,
    senderWindowId: senderWindow?.id ?? null,
    ...options
  })) {
    throw new Error('拒绝来自非主应用页面的 IPC 请求')
  }
}
```

Store the main window in `electron/main.ts`, export a getter, and call `assertTrustedIpcSender` as the first statement in every `ipcMain.handle` callback.

- [ ] **Step 4: Restrict main-window navigation, windows, and permissions**

Add after main-window creation:

```ts
const devRendererUrl = isDev ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererRoot = join(__dirname, '../renderer')

mainWindow.webContents.on('will-navigate', (event, url) => {
  if (!isTrustedMainRendererUrl(url, devRendererUrl, rendererRoot)) event.preventDefault()
})
mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
```

Apply `isAllowedPlatformNavigation` and `setWindowOpenHandler(() => ({ action: 'deny' }))` to login and signer windows with platform-specific host suffixes. Do not add a preload to those remote windows.

- [ ] **Step 5: Run targeted tests and build**

Run:

```bash
npx vitest run electron/security/navigation-policy.test.ts electron/security/ipc-guard.test.ts
npm run build
```

Expected: tests and build PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/ipc electron/services/browser/ElectronLoginWindow.ts electron/services/sign/SignService.ts electron/security
git commit -m "fix: harden Electron and IPC boundaries"
```

### Task 3: File Authorization and Bounded Data URLs

**Files:**
- Create: `electron/security/file-access-policy.ts`
- Create: `electron/security/file-access-policy.test.ts`
- Create: `electron/utils/data-url.ts`
- Create: `electron/utils/data-url.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/ipc/file-dialog.ipc.ts`
- Modify: `electron/ipc/publish.ipc.ts`
- Modify: `electron/ipc/scheduler.ipc.ts`
- Modify: `src/constants/ipc-channels.ts`
- Modify: `src/components/publish/VideoDropZone.tsx`
- Modify: `src/vite-env.d.ts`

- [ ] **Step 1: Write failing file-policy tests**

```ts
import { describe, expect, it } from 'vitest'
import { FileAccessPolicy } from './file-access-policy'

describe('FileAccessPolicy', () => {
  it('does not authorize the entire home directory', () => {
    const policy = new FileAccessPolicy(['/app/userData'], ['/tmp/flow'])
    expect(policy.isAllowed('/Users/test/.ssh/id_rsa')).toBe(false)
  })

  it('accepts explicitly authorized files and rejects sibling prefixes', () => {
    const policy = new FileAccessPolicy(['/app/userData'], ['/tmp/flow'])
    policy.authorize('/Users/test/Videos/a.mp4')
    expect(policy.isAllowed('/Users/test/Videos/a.mp4')).toBe(true)
    expect(policy.isAllowed('/app/userData-evil/file')).toBe(false)
  })
})
```

- [ ] **Step 2: Write failing data-URL tests**

```ts
import { describe, expect, it } from 'vitest'
import { parseImageDataUrl } from './data-url'

describe('parseImageDataUrl', () => {
  it('rejects unsupported image MIME types', () => {
    expect(() => parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=', 50)).toThrow('不支持的图片格式')
  })

  it('rejects decoded data larger than the limit', () => {
    const data = Buffer.alloc(51).toString('base64')
    expect(() => parseImageDataUrl(`data:image/png;base64,${data}`, 50)).toThrow('图片文件过大')
  })
})
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx vitest run electron/security/file-access-policy.test.ts electron/utils/data-url.test.ts
```

Expected: FAIL because modules are missing.

- [ ] **Step 4: Implement minimal policy and parser**

```ts
// electron/security/file-access-policy.ts
import { existsSync, realpathSync } from 'fs'
import { resolve, sep } from 'path'

function canonical(path: string): string {
  const resolved = resolve(path)
  return existsSync(resolved) ? realpathSync(resolved) : resolved
}

function isWithin(path: string, root: string): boolean {
  const candidate = canonical(path)
  const base = canonical(root)
  return candidate === base || candidate.startsWith(`${base}${sep}`)
}

export class FileAccessPolicy {
  private authorized = new Set<string>()
  constructor(
    private appOwnedRoots: string[],
    private temporaryRoots: string[]
  ) {}

  authorize(path: string): string {
    const value = canonical(path)
    this.authorized.add(value)
    return value
  }

  isAllowed(path: string): boolean {
    const value = canonical(path)
    return this.authorized.has(value) ||
      [...this.appOwnedRoots, ...this.temporaryRoots].some((root) => isWithin(value, root))
  }
}
```

```ts
// electron/utils/data-url.ts
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif'
}

export function parseImageDataUrl(value: string, maxBytes = 50 * 1024 * 1024) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value)
  if (!match || !MIME_EXTENSIONS[match[1]]) throw new Error('不支持的图片格式')
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length > maxBytes) throw new Error('图片文件过大（最大50MB）')
  return { buffer, extension: MIME_EXTENSIONS[match[1]], mime: match[1] }
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
npx vitest run electron/security/file-access-policy.test.ts electron/utils/data-url.test.ts
```

Expected: PASS.

- [ ] **Step 6: Wire authorization through Electron**

Create one policy instance after `app.whenReady()` using:

```ts
new FileAccessPolicy(
  [app.getPath('userData')],
  [join(app.getPath('temp'), 'videosync-frames')]
)
```

Register picker results and app-created covers. Add `file:authorize-path` IPC used immediately after `webUtils.getPathForFile(file)` in the preload bridge. Replace home-root checks in `local-file` and `FILE_READ_DATA_URL` with `policy.isAllowed()`. Require allowed paths before probe, extraction, validation, upload, submit cover upload, and schedule creation.

- [ ] **Step 7: Fix data-URL persistence**

Replace the permissive regex/`Buffer.from` sequence in `FILE_DATA_URL_TO_TEMP` with:

```ts
const { buffer, extension } = parseImageDataUrl(dataUrl)
const fileName = `cover-${randomBytes(8).toString('hex')}.${extension}`
```

Authorize the generated path after writing.

- [ ] **Step 8: Run tests and build**

Run:

```bash
npx vitest run electron/security/file-access-policy.test.ts electron/utils/data-url.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add electron/security/file-access-policy* electron/utils/data-url* electron/main.ts electron/preload.ts electron/ipc src/constants/ipc-channels.ts src/components/publish/VideoDropZone.tsx src/vite-env.d.ts
git commit -m "fix: restrict renderer file access"
```

### Task 4: Secure Remote Transport

**Files:**
- Create: `electron/security/secure-transport.ts`
- Create: `electron/security/secure-transport.test.ts`
- Modify: `electron/services/http/HttpClient.ts`
- Modify: `electron/services/openapi/KuaishouOpenApiPublisher.ts`
- Modify: `electron/services/location/IPLocationService.ts`
- Modify: `electron/services/browser/BrowserManager.ts`
- Modify: `electron/services/platform-adapters/douyin/DouyinApiAdapter.ts`
- Modify: `electron/services/platform-adapters/xiaohongshu/XhsApiAdapter.ts`
- Modify: `electron/services/platform-adapters/kuaishou/KsApiAdapter.ts`
- Modify: `electron/services/platform-adapters/wechat-channels/WcApiAdapter.ts`

- [ ] **Step 1: Write failing transport tests**

```ts
import { describe, expect, it } from 'vitest'
import { requireSecureUploadEndpoint } from './secure-transport'

describe('secure transport', () => {
  it('rejects plaintext remote upload endpoints', () => {
    expect(() => requireSecureUploadEndpoint('upload.kuaishouzt.com')).toThrow('HTTPS')
    expect(() => requireSecureUploadEndpoint('http://upload.kuaishouzt.com')).toThrow('HTTPS')
  })

  it('accepts HTTPS upload endpoints', () => {
    expect(requireSecureUploadEndpoint('https://upload.kuaishouzt.com')).toBe('https://upload.kuaishouzt.com')
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npx vitest run electron/security/secure-transport.test.ts
```

Expected: FAIL because the helper is missing.

- [ ] **Step 3: Implement endpoint validation**

```ts
// electron/security/secure-transport.ts
export function requireSecureUploadEndpoint(value: string): string {
  const normalized = value.includes('://') ? value : `https://${value}`
  const url = new URL(normalized)
  if (url.protocol !== 'https:') throw new Error('上传端点必须使用 HTTPS')
  if (!url.hostname) throw new Error('上传端点无效')
  return url.origin
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
npx vitest run electron/security/secure-transport.test.ts
```

Expected: PASS.

- [ ] **Step 5: Remove insecure transport**

Make these exact behavior changes:

- `HttpClient`: use a normal `HttpsAgent({ rejectUnauthorized: true })` for every HTTPS request; remove `secureTls` and permissive CDN selection.
- Kuaishou OpenAPI: build direct/fragment/complete URLs from `requireSecureUploadEndpoint(endpoint)`.
- Replace `http://ip-api.com` with its HTTPS endpoint, or remove that provider if HTTPS is unavailable.
- Remove every `rejectUnauthorized: false`.
- Remove `ignoreHTTPSErrors: true`.
- Keep loopback signer HTTP unchanged.

Then run:

```bash
rg -n "rejectUnauthorized:\\s*false|ignoreHTTPSErrors:\\s*true|http://\\$\\{endpoint\\}|http://ip-api\\.com" electron
```

Expected: no matches.

- [ ] **Step 6: Run tests and build**

Run:

```bash
npx vitest run electron/security/secure-transport.test.ts
npm test
npm run build
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/security/secure-transport* electron/services/http/HttpClient.ts electron/services/openapi/KuaishouOpenApiPublisher.ts electron/services/location/IPLocationService.ts electron/services/browser/BrowserManager.ts electron/services/platform-adapters
git commit -m "fix: enforce secure remote transport"
```

### Task 5: Publish Relationship and State Validation

**Files:**
- Create: `electron/services/publish/publish-validation.ts`
- Create: `electron/services/publish/publish-validation.test.ts`
- Modify: `electron/ipc/publish.ipc.ts`

- [ ] **Step 1: Write failing validation tests**

```ts
import { describe, expect, it } from 'vitest'
import { validateUploadRelationship, validateSubmitRelationship } from './publish-validation'

describe('publish relationship validation', () => {
  const account = { id: 'a1', platform: 'douyin', session_status: 'logged_in' }
  const record = { id: 'r1', account_id: 'a1', platform: 'douyin', status: 'uploaded' }

  it('rejects upload through another platform adapter', () => {
    expect(() => validateUploadRelationship(account, 'xiaohongshu')).toThrow('账号与平台不匹配')
  })

  it('rejects submit through another platform adapter', () => {
    expect(() => validateSubmitRelationship(record, account, 'xiaohongshu')).toThrow('发布记录与平台不匹配')
  })

  it('rejects records outside allowed submit states', () => {
    expect(() => validateSubmitRelationship({ ...record, status: 'done' }, account, 'douyin'))
      .toThrow('当前状态不允许提交')
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run electron/services/publish/publish-validation.test.ts
```

Expected: FAIL because validation module is missing.

- [ ] **Step 3: Implement minimal validation**

```ts
const SUBMITTABLE_STATES = new Set(['uploaded', 'error'])

export function validateUploadRelationship(
  account: { platform: string; session_status: string },
  platformId: string
): void {
  if (account.platform !== platformId) throw new Error('账号与平台不匹配')
  if (account.session_status !== 'logged_in') throw new Error('账号未登录，请先登录')
}

export function validateSubmitRelationship(
  record: { platform: string; account_id: string; status: string },
  account: { id: string; platform: string },
  platformId: string
): void {
  if (record.platform !== platformId) throw new Error('发布记录与平台不匹配')
  if (account.id !== record.account_id || account.platform !== platformId) {
    throw new Error('发布记录账号与平台不匹配')
  }
  if (!SUBMITTABLE_STATES.has(record.status)) throw new Error('发布记录当前状态不允许提交')
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npx vitest run electron/services/publish/publish-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Apply validation before side effects**

In upload, validate immediately after account lookup and before `recordRepo.create()`.

In submit:

```ts
const account = accountRepo.getById(record.account_id)
if (!account) return { success: false, error: '发布记录账号不存在' }
validateSubmitRelationship(record, account, params.platformId)
```

Perform validation before `recordRepo.updateStatus(..., 'submitting')`.

- [ ] **Step 6: Run targeted tests and build**

Run:

```bash
npx vitest run electron/services/publish/publish-validation.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/services/publish electron/ipc/publish.ipc.ts
git commit -m "fix: validate publish ownership and state"
```

### Task 6: Scheduled Publish Idempotency

**Files:**
- Create: `electron/services/database/migrations/008_scheduled_publish_source.ts`
- Create: `electron/services/scheduler/scheduled-publish-policy.ts`
- Create: `electron/services/scheduler/scheduled-publish-policy.test.ts`
- Modify: `electron/services/database/index.ts`
- Modify: `electron/services/database/schema.ts`
- Modify: `electron/services/database/repositories/publish-record.repo.ts`
- Modify: `electron/services/database/repositories/scheduled-task.repo.ts`
- Modify: `electron/services/scheduler/TaskQueue.ts`

- [ ] **Step 1: Write failing state-policy tests**

```ts
import { describe, expect, it } from 'vitest'
import { decideScheduledPublishAction } from './scheduled-publish-policy'

describe('scheduled publish recovery policy', () => {
  it('continues from uploaded without creating another upload', () => {
    expect(decideScheduledPublishAction('uploaded')).toBe('submit')
  })

  it('never resubmits an ambiguous submitting record', () => {
    expect(decideScheduledPublishAction('submitting')).toBe('mark-unconfirmed')
  })

  it('does nothing for completed or unconfirmed records', () => {
    expect(decideScheduledPublishAction('done')).toBe('skip')
    expect(decideScheduledPublishAction('unconfirmed')).toBe('skip')
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run electron/services/scheduler/scheduled-publish-policy.test.ts
```

Expected: FAIL because policy module is missing.

- [ ] **Step 3: Implement the state policy**

```ts
export type ScheduledPublishAction = 'upload' | 'submit' | 'mark-unconfirmed' | 'skip'

export function decideScheduledPublishAction(status: string): ScheduledPublishAction {
  if (status === 'uploaded') return 'submit'
  if (status === 'submitting') return 'mark-unconfirmed'
  if (status === 'done' || status === 'unconfirmed') return 'skip'
  return 'upload'
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npx vitest run electron/services/scheduler/scheduled-publish-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add migration 008**

```ts
import type { Database } from 'sql.js'

export function runMigration008(db: Database): void {
  const columns = db.exec("PRAGMA table_info('publish_records')")
  const names = columns[0]?.values.map((row) => String(row[1])) || []
  if (!names.includes('source_task_id')) {
    db.run('ALTER TABLE publish_records ADD COLUMN source_task_id TEXT')
  }
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_records_source_task_platform
    ON publish_records(source_task_id, platform)
    WHERE source_task_id IS NOT NULL
  `)
}
```

Register migration version 8 in `database/index.ts`.

- [ ] **Step 6: Add repository methods**

Add:

```ts
getBySourceTaskAndPlatform(taskId: string, platform: string): PublishRecordRow | null
createScheduled(data: ExistingCreateData & { sourceTaskId: string }): PublishRecordRow
incrementRetry(id: string): void
```

`createScheduled` writes `source_task_id`. `incrementRetry` must be used before each upload retry after the first attempt.

- [ ] **Step 7: Refactor TaskQueue upload and submit stages**

Replace whole-flow `retry(() => publishToPlatform(...))` with:

```ts
const record = recordRepo.getBySourceTaskAndPlatform(task.id, platformId) ??
  recordRepo.createScheduled({ ...recordData, sourceTaskId: task.id })

const action = decideScheduledPublishAction(record.status)
if (action === 'skip') return
if (action === 'mark-unconfirmed') {
  recordRepo.updateStatus(record.id, 'unconfirmed', 99, '上次提交结果未知，已停止自动重试')
  throw new Error('上次提交结果未知，需要人工核对，未再次提交')
}

if (action === 'upload') {
  const uploadResult = await retryUploadOnly(record, async (attempt) => {
    if (attempt > 1) this.scheduledTaskRepo.incrementRetry(task.id)
    return adapter.uploadVideoAPI!(...)
  })
  recordRepo.saveUploadMeta(record.id, uploadResult.meta)
  recordRepo.updateStatus(record.id, 'uploaded', 100)
}

recordRepo.updateStatus(record.id, 'submitting', 90)
saveDatabase()
try {
  const result = await adapter.submitContentAPI!(...)
  recordRepo.updateStatus(record.id, 'done', 100)
} catch (error) {
  recordRepo.updateStatus(record.id, 'unconfirmed', 99, String(error))
  throw new Error(`提交结果无法确认，已停止自动重试: ${String(error)}`)
}
```

The final submit call must appear outside any generic `retry()` wrapper.

- [ ] **Step 8: Add a source-level regression assertion**

Add to `scheduled-publish-policy.test.ts`:

```ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

it('does not wrap publishToPlatform or final submit in generic retry', () => {
  const source = readFileSync(resolve(__dirname, 'TaskQueue.ts'), 'utf8')
  expect(source).not.toMatch(/retry\\(\\s*\\(\\) => this\\.publishToPlatform/)
  expect(source).not.toMatch(/retry\\([\\s\\S]{0,500}submitContentAPI/)
})
```

- [ ] **Step 9: Run tests and build**

Run:

```bash
npx vitest run electron/services/scheduler/scheduled-publish-policy.test.ts
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add electron/services/database electron/services/scheduler
git commit -m "fix: make scheduled publishing idempotent"
```

### Task 7: Listener Lifecycle, Account Preservation, and Sensitive Artifacts

**Files:**
- Create: `electron/preload-listener.test.ts`
- Modify: `electron/preload.ts`
- Create: `electron/services/account/account-policy.ts`
- Create: `electron/services/account/account-policy.test.ts`
- Modify: `electron/ipc/account.ipc.ts`
- Modify: `.gitignore`
- Delete: `captured-submit-payload.json`

- [ ] **Step 1: Extract and test listener wrapping**

Create a small exported helper in `electron/preload.ts` or a side-effect-free `electron/preload-listener.ts`:

```ts
export function subscribeIpc(
  on: (channel: string, listener: (...args: unknown[]) => void) => void,
  remove: (channel: string, listener: (...args: unknown[]) => void) => void,
  channel: string,
  listener: (...args: unknown[]) => void
): () => void {
  const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args)
  on(channel, wrapped)
  return () => remove(channel, wrapped)
}
```

Test:

```ts
it('removes the same wrapper that was registered', () => {
  let registered: ((...args: unknown[]) => void) | undefined
  let removed: ((...args: unknown[]) => void) | undefined
  const unsubscribe = subscribeIpc(
    (_channel, fn) => { registered = fn },
    (_channel, fn) => { removed = fn },
    'publish:progress',
    () => {}
  )
  unsubscribe()
  expect(removed).toBe(registered)
})
```

- [ ] **Step 2: Run listener test and verify RED**

Run:

```bash
npx vitest run electron/preload-listener.test.ts
```

Expected: FAIL until helper exists.

- [ ] **Step 3: Implement and wire listener helper**

Use `subscribeIpc` for `on`. For `once`, create a wrapper and pass it directly to `ipcRenderer.once`.

- [ ] **Step 4: Add account-preservation test**

```ts
import { describe, expect, it } from 'vitest'
import { selectReusableAccount } from './account-policy'

describe('account policy', () => {
  it('selects an existing account without deleting siblings', () => {
    const accounts = [
      { id: 'old', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'new', updated_at: '2026-02-01T00:00:00Z' }
    ]
    expect(selectReusableAccount(accounts)?.id).toBe('new')
    expect(accounts).toHaveLength(2)
  })
})
```

- [ ] **Step 5: Remove startup deletion and use selection policy**

```ts
export function selectReusableAccount<T extends { updated_at: string }>(accounts: T[]): T | null {
  return [...accounts].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null
}
```

Delete the startup loop calling `repo.deleteById`. Login may reuse the selected account but must not mutate the account list.

- [ ] **Step 6: Remove tracked captured payload**

Delete `captured-submit-payload.json` and add:

```gitignore
captured-*-payload.json
*.har
```

Do not rewrite history in this batch.

- [ ] **Step 7: Run tests and build**

Run:

```bash
npx vitest run electron/preload-listener.test.ts electron/services/account/account-policy.test.ts
npm run build
git ls-files captured-submit-payload.json
```

Expected: tests/build PASS; final command prints nothing.

- [ ] **Step 8: Commit**

```bash
git add electron/preload.ts electron/preload-listener* electron/services/account electron/ipc/account.ipc.ts .gitignore
git rm captured-submit-payload.json
git commit -m "fix: preserve accounts and remove sensitive artifact"
```

### Task 8: Redact Sensitive Logs

**Files:**
- Modify: `electron/services/http/HttpClient.ts`
- Modify: `electron/ipc/publish.ipc.ts`
- Modify: `electron/services/browser/BrowserManager.ts`
- Modify: `electron/services/browser/ElectronLoginWindow.ts`
- Modify: `electron/services/platform-adapters/douyin/DouyinApiAdapter.ts`
- Modify: `electron/services/platform-adapters/xiaohongshu/XhsApiAdapter.ts`
- Modify: `electron/services/platform-adapters/kuaishou/KsApiAdapter.ts`
- Modify: `electron/services/platform-adapters/wechat-channels/WcApiAdapter.ts`
- Create: `electron/utils/log-redaction.ts`
- Create: `electron/utils/log-redaction.test.ts`

- [ ] **Step 1: Write failing redaction tests**

```ts
import { describe, expect, it } from 'vitest'
import { redactUrl, summarizePayload } from './log-redaction'

describe('log redaction', () => {
  it('redacts sensitive query values', () => {
    expect(redactUrl('https://x.test/upload?upload_token=secret&access_token=abc'))
      .toBe('https://x.test/upload?upload_token=%5BREDACTED%5D&access_token=%5BREDACTED%5D')
  })

  it('logs payload shape rather than content', () => {
    expect(summarizePayload({ caption: 'private text', token: 'secret' }))
      .toEqual({ keys: ['caption', 'token'], byteLength: expect.any(Number) })
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run electron/utils/log-redaction.test.ts
```

Expected: FAIL because helper is missing.

- [ ] **Step 3: Implement redaction helper**

```ts
const SENSITIVE_QUERY_KEYS = new Set([
  'access_token', 'upload_token', 'token', 'api_ph', 'kuaishou.web.cp.api_ph'
])

export function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]')
    }
    return url.toString()
  } catch {
    return '[invalid-url]'
  }
}

export function summarizePayload(value: unknown): { keys: string[]; byteLength: number } {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).sort()
    : []
  return { keys, byteLength: Buffer.byteLength(serialized) }
}
```

- [ ] **Step 4: Replace sensitive logs**

Remove or replace:

- Upload-token prefixes.
- Full request/submit bodies.
- Full platform fields.
- Authorization-bearing `X-Arguments` or URLs.
- Browser network monitor body dumps.

Use `redactUrl()` and `summarizePayload()` instead.

- [ ] **Step 5: Run tests and scan**

Run:

```bash
npx vitest run electron/utils/log-redaction.test.ts
rg -n "Upload token obtained:|Body \\(string|Submit to post_create, body|platformFields=|NET-MON.*Body|xArgs:" electron
```

Expected: test PASS; scan has no sensitive body/token logging matches.

- [ ] **Step 6: Commit**

```bash
git add electron/utils/log-redaction* electron/services electron/ipc/publish.ipc.ts
git commit -m "fix: redact sensitive publishing logs"
```

### Task 9: Final Verification and Guardrail Audit

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run the complete automated test suite**

Run:

```bash
npm test
```

Expected: all tests PASS with zero failed files.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: exit code 0.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: no new errors in changed files. If unrelated historical errors remain, record the exact total and run ESLint directly on every changed `.ts`/`.tsx` file to prove the repair set is clean.

- [ ] **Step 4: Scan transport and Electron boundaries**

Run:

```bash
rg -n "rejectUnauthorized:\\s*false|ignoreHTTPSErrors:\\s*true|http://ip-api\\.com|http://\\$\\{endpoint\\}" electron
rg -n "setWindowOpenHandler|will-navigate|setPermissionRequestHandler|assertTrustedIpcSender" electron/main.ts electron/ipc electron/services/browser electron/services/sign
```

Expected: insecure transport scan has no matches; boundary scan shows the expected guards.

- [ ] **Step 5: Re-audit API/HTTP-only publishing**

Run:

```bash
rg -n "setInputFiles|filechooser|fileChooser|keyboard\\.|mouse\\.|submitBtn.*click|uploadInput.*click" electron src shared -g '*.{ts,tsx}'
```

Expected: no UI publishing execution. Login-button clicks may remain only in login flow.

- [ ] **Step 6: Verify repository and sensitive artifacts**

Run:

```bash
git status --short
git ls-files captured-submit-payload.json
git diff --check HEAD~8..HEAD
```

Expected: no captured payload tracked and no whitespace errors. Worktree is clean after commits.

- [ ] **Step 7: Request code review**

Invoke `superpowers:requesting-code-review` with the design, this plan, base SHA `7c5e325^`, and current HEAD. Fix every Critical and Important finding before completion.

- [ ] **Step 8: Final verification after review fixes**

Run again:

```bash
npm test
npm run build
```

Expected: PASS.

