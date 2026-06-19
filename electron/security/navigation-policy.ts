import { resolve, sep } from 'path'
import { fileURLToPath } from 'url'

function hostMatches(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase()
  const allowed = suffix.toLowerCase()
  return host === allowed || host.endsWith(`.${allowed}`)
}

export function isLoopbackHost(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
    hostname.toLowerCase()
  )
}

export function isSecureRemoteUrl(
  value: string,
  options: { allowLoopbackHttp?: boolean } = {}
): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' ||
      (options.allowLoopbackHttp === true &&
        url.protocol === 'http:' &&
        isLoopbackHost(url.hostname))
    )
  } catch {
    return false
  }
}

export function isAllowedPlatformNavigation(
  value: string,
  hostSuffixes: string[]
): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      hostSuffixes.some((suffix) => hostMatches(url.hostname, suffix))
    )
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
    if (devRendererUrl) {
      return url.origin === new URL(devRendererUrl).origin
    }
    if (url.protocol !== 'file:' || !rendererRoot) return false

    const candidate = resolve(fileURLToPath(url))
    const root = resolve(rendererRoot)
    return candidate === root || candidate.startsWith(`${root}${sep}`)
  } catch {
    return false
  }
}
