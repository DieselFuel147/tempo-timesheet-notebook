import type { DryRunSummary, NotebookBlock, PushSummary } from '@shared/types'
import { isPersistedNotebookBlock, notebookBlockSummary } from '@shared/notebook'

export type PushState =
  | { mode: 'idle' }
  | { mode: 'running'; action: 'dry-run' | 'push' }
  | { mode: 'done'; action: 'dry-run' | 'push'; summary: DryRunSummary | PushSummary }

export function isPushableBlock(block: NotebookBlock): boolean {
  return block.closed && block.startMinute !== null && block.endMinute !== null && notebookBlockSummary(block).trim().length > 0
}

export function blockSyncLabel(block: NotebookBlock): { label: string; color: 'default' | 'success' | 'warning' } | null {
  if (!isPersistedNotebookBlock(block) || !isPushableBlock(block)) return null
  if (block.tempoWorklogId) return { label: 'synced to Tempo', color: 'success' }
  return { label: 'ready to sync', color: 'warning' }
}
