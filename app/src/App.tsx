import { Switch, Match, Show, onCleanup, onMount } from 'solid-js'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { view } from './stores/appStore'
import { environmentStatus, loadEnvironmentStatus, retryEnvironmentSetup, setEnvironmentStatus, type EnvironmentStatus } from './stores/environmentStore'
import UploadView from './views/UploadView'
import RecordingView from './views/RecordingView'
import ProcessingView from './views/ProcessingView'
import ResultView from './views/ResultView'
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
      <Switch>
        <Match when={view() === 'upload'}>
          <UploadView />
        </Match>
        <Match when={view() === 'recording'}>
          <RecordingView />
        </Match>
        <Match when={view() === 'processing'}>
          <ProcessingView />
        </Match>
        <Match when={view() === 'result'}>
          <ResultView />
        </Match>
      </Switch>
      <Show when={!environmentStatus().ready}>
        <EnvironmentOverlay status={environmentStatus()} onRetry={retryEnvironmentSetup} />
      </Show>
    </div>
  )
}
