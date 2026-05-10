import type { IPlatformAdapter } from './IPlatformAdapter'

const adapters = new Map<string, IPlatformAdapter>()

export type PublishMode = 'api' | 'browser'

let currentMode: PublishMode = 'api'

export function registerAdapter(adapter: IPlatformAdapter): void {
  adapters.set(adapter.platformId, adapter)
}

export function getAdapter(platformId: string): IPlatformAdapter | undefined {
  return adapters.get(platformId)
}

export function getAllAdapters(): IPlatformAdapter[] {
  return Array.from(adapters.values())
}

export function setPublishMode(mode: PublishMode): void {
  currentMode = mode
}

export function getPublishMode(): PublishMode {
  return currentMode
}

/**
 * Check if an adapter supports API mode.
 * An adapter supports API mode if it implements uploadVideoAPI and submitContentAPI.
 */
export function supportsApiMode(platformId: string): boolean {
  const adapter = adapters.get(platformId)
  if (!adapter) return false
  return !!(adapter.uploadVideoAPI && adapter.submitContentAPI)
}

/**
 * Get the effective publish mode for a given platform.
 * Falls back to 'browser' if the platform doesn't support API mode.
 */
export function getEffectiveMode(platformId: string): PublishMode {
  if (currentMode === 'api' && supportsApiMode(platformId)) {
    return 'api'
  }
  return 'browser'
}
