import { invoke } from '@tauri-apps/api/core'
import type { BatchMetadata } from '../stores/batchStore'

interface PipelineResultRaw {
  metadata: BatchMetadata
  midi_path: string | null
  perf_midi_path: string | null
}

export function startPipeline(input: string, backend = 'transkun', soloPiano = false): Promise<PipelineResultRaw> {
  return invoke<PipelineResultRaw>('start_pipeline', { input, backend, soloPiano })
}
