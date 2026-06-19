type IpcListener = (...args: unknown[]) => void

export function subscribeIpc(
  on: (channel: string, listener: IpcListener) => void,
  remove: (channel: string, listener: IpcListener) => void,
  channel: string,
  listener: IpcListener
): () => void {
  const wrapped: IpcListener = (_event, ...args) => listener(...args)
  on(channel, wrapped)
  return () => remove(channel, wrapped)
}
