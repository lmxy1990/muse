import { createSignal } from 'solid-js'
import { invoke } from '@tauri-apps/api/core'

export interface EnvironmentStatus {
  ready: boolean
  running: boolean
  percent: number
  error: string | null
  log_path: string
}

const [status, setStatus] = createSignal<EnvironmentStatus>({
  ready: false,
  running: true,
  percent: 0,
  error: null,
  log_path: '',
})

export function setEnvironmentStatus(next: EnvironmentStatus) {
  setStatus(next)
}

export async function loadEnvironmentStatus() {
  try {
    setStatus(await invoke<EnvironmentStatus>('get_environment_status'))
  } catch (error) {
    setStatus((current) => ({
      ...current,
      running: false,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}

export async function retryEnvironmentSetup() {
  try {
    setStatus(await invoke<EnvironmentStatus>('retry_environment_setup'))
  } catch (error) {
    setStatus((current) => ({
      ...current,
      running: false,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}

export { status as environmentStatus }
