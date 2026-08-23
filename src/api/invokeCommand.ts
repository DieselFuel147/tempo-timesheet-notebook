import type { NativeCommandError, TauriCommandContracts, TauriCommandOutput } from '@shared/tauri-contracts'

type InvokeArgs = Record<string, unknown> | undefined

function toError(error: unknown): Error {
  if (error && typeof error === 'object' && 'message' in error) {
    const nativeError = error as NativeCommandError
    return new Error(nativeError.message)
  }
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  return new Error('Unknown error')
}

export async function invokeCommand<TName extends keyof TauriCommandContracts>(
  command: TName,
  args?: InvokeArgs,
): Promise<TauriCommandOutput<TName>> {
  const { invoke } = await import('@tauri-apps/api/core')

  try {
    return await invoke<TauriCommandOutput<TName>>(command, args)
  } catch (error) {
    throw toError(error)
  }
}
