import type { IPlatformAdapter } from './IPlatformAdapter'

const adapters = new Map<string, IPlatformAdapter>()

export function registerAdapter(adapter: IPlatformAdapter): void {
  adapters.set(adapter.platformId, adapter)
}

export function getAdapter(platformId: string): IPlatformAdapter | undefined {
  return adapters.get(platformId)
}

export function getAllAdapters(): IPlatformAdapter[] {
  return Array.from(adapters.values())
}
