import { existsSync, realpathSync } from 'fs'
import { resolve, sep } from 'path'

function canonical(filePath: string): string {
  const resolved = resolve(filePath)
  return existsSync(resolved) ? realpathSync(resolved) : resolved
}

function comparable(filePath: string): string {
  return process.platform === 'darwin' ? filePath.toLowerCase() : filePath
}

function isWithin(filePath: string, root: string): boolean {
  const candidate = comparable(canonical(filePath))
  const base = comparable(canonical(root))
  return candidate === base || candidate.startsWith(`${base}${sep}`)
}

export class FileAccessPolicy {
  private authorized = new Set<string>()

  constructor(
    private appOwnedRoots: string[],
    private temporaryRoots: string[]
  ) {}

  authorize(filePath: string): string {
    const value = canonical(filePath)
    this.authorized.add(comparable(value))
    return value
  }

  isAllowed(filePath: string): boolean {
    const value = canonical(filePath)
    return (
      this.authorized.has(comparable(value)) ||
      [...this.appOwnedRoots, ...this.temporaryRoots].some((root) =>
        isWithin(value, root)
      )
    )
  }
}

let fileAccessPolicy: FileAccessPolicy | null = null

export function configureFileAccessPolicy(
  appOwnedRoots: string[],
  temporaryRoots: string[]
): FileAccessPolicy {
  fileAccessPolicy = new FileAccessPolicy(appOwnedRoots, temporaryRoots)
  return fileAccessPolicy
}

export function getFileAccessPolicy(): FileAccessPolicy {
  if (!fileAccessPolicy) {
    throw new Error('文件访问策略尚未初始化')
  }
  return fileAccessPolicy
}

export function requireAllowedFile(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('无效的文件路径')
  }
  if (!getFileAccessPolicy().isAllowed(filePath)) {
    throw new Error('禁止访问未经授权的文件')
  }
  return canonical(filePath)
}
