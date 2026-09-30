import { Show, onCleanup, onMount } from 'solid-js'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { environmentStatus, loadEnvironmentStatus, retryEnvironmentSetup, setEnvironmentStatus, type EnvironmentStatus } from './stores/environmentStore'
import WorkspaceView from './views/WorkspaceView'
import EnvironmentOverlay from './components/EnvironmentOverlay'

export default function App() {
  let unlisten: UnlistenFn | undefined

  onMount(() => {
    loadEnvironmentStatus()
    listen<EnvironmentStatus>('environment:status', (event) => {
      setEnvironmentStatus(event.payload)
    }).then((dispose) => {
      unlisten = dispose
    })
  })

  onCleanup(() => unlisten?.())

  return (
    <div class="w-full h-full flex flex-col bg-bg-primary">
      <WorkspaceView />
      <Show when={!environmentStatus().ready}>
        <EnvironmentOverlay status={environmentStatus()} onRetry={retryEnvironmentSetup} />
      </Show>
    </div>
  )
}
