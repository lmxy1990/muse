import { createMemo, createSignal, For, Show } from 'solid-js'
import { open } from '@tauri-apps/plugin-dialog'
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileAudio,
  FileMusic,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-solid'
import PlaybackPanel from '../components/PlaybackPanel'
import ExportBar from '../components/ExportBar'
import { onPipelineProgress } from '../lib/events'
import { startPipeline } from '../lib/commands'
import { toPlaybackUrl } from '../lib/playbackAdapter'
import {
  addAudioFiles,
  backend,
  jobs,
  queuedCount,
  running,
  selectPlayback,
  selection,
  setBackend,
  setRunning,
  updateJob,
  retryJob,
  removeJob,
  type AudioJob,
  type OutputKind,
} from '../stores/batchStore'

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma']

function errorMessage(error: unknown) {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return '转录失败'
}

export default function WorkspaceView() {
  let activeJobId: string | null = null
  const [notice, setNotice] = createSignal<string | null>(null)
  const [playRequest, setPlayRequest] = createSignal(0)
  const [requestedSelection, setRequestedSelection] = createSignal<string | null>(null)
  const [includeScoreMidi, setIncludeScoreMidi] = createSignal(false)
  const [includePerformanceMidi, setIncludePerformanceMidi] = createSignal(true)

  const outputFiles = createMemo(() => jobs().flatMap((job) => {
    const outputs: Array<{ job: AudioJob; kind: OutputKind; path: string; name: string }> = []
    if (job.midiPath) outputs.push({ job, kind: 'score', path: job.midiPath, name: fileName(job.midiPath) })
    if (job.perfMidiPath) outputs.push({ job, kind: 'performance', path: job.perfMidiPath, name: fileName(job.perfMidiPath) })
    return outputs
  }))

  const selectedJob = createMemo(() => {
    const id = selection()?.jobId
    return id ? jobs().find((job) => job.id === id) : undefined
  })

  const selectedOutput = createMemo(() => {
    const current = selection()
    if (!current || current.kind === 'audio') return null
    return outputFiles().find((file) => file.job.id === current.jobId && file.kind === current.kind) || null
  })

  const playbackSelectionKey = createMemo(() => {
    const current = selection()
    const job = selectedJob()
    if (!current || !job) return ''
    return `${job.id}:${current.kind}`
  })

  const playbackKey = createMemo(() => {
    const current = selection()
    const job = selectedJob()
    if (!current || !job) return ''
    return `${playbackSelectionKey()}:${job.midiPath || ''}:${job.perfMidiPath || ''}:${playRequest()}`
  })

  const addFiles = async (paths: string[]) => {
    try {
      const files = await Promise.all(paths.map(async (path) => ({
        path,
        name: fileName(path),
        audioUrl: await toPlaybackUrl(path),
      })))
      addAudioFiles(files)
      setNotice(null)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const chooseFiles = async () => {
    const result = await open({
      multiple: true,
      directory: false,
      filters: [{ name: '音频文件', extensions: AUDIO_EXTENSIONS }],
    })
    if (result) await addFiles(Array.isArray(result) ? result : [result])
  }

  const runBatch = async () => {
    if (running() || queuedCount() === 0) return
    setRunning(true)
    setNotice(null)
    let unlisten: (() => void) | undefined

    try {
      unlisten = await onPipelineProgress((progress) => {
        if (activeJobId) updateJob(activeJobId, { progress: progress.percent })
      })

      const queue = jobs().filter((job) => job.status === 'queued')
      for (const job of queue) {
        if (!jobs().some((current) => current.id === job.id && current.status === 'queued')) continue
        activeJobId = job.id
        updateJob(job.id, { status: 'processing', progress: 0, error: null })

        try {
          const result = await startPipeline(
            job.path,
            backend(),
            backend() === 'transkun',
            includeScoreMidi(),
            includePerformanceMidi(),
          )
          updateJob(job.id, {
            status: 'completed',
            progress: 100,
            midiPath: result.midi_path,
            perfMidiPath: result.perf_midi_path,
            metadata: result.metadata,
          })
        } catch (error) {
          updateJob(job.id, { status: 'failed', progress: 0, error: errorMessage(error) })
        }
      }
    } finally {
      unlisten?.()
      activeJobId = null
      setRunning(false)
      if (jobs().some((job) => job.status === 'failed')) {
        setNotice('批量转录完成，失败任务已跳过，可单独重试。')
      } else {
        setNotice('批量转录完成。')
      }
    }
  }

  const requestPlayback = (item: { jobId: string; kind: 'audio' | OutputKind }) => {
    setRequestedSelection(`${item.jobId}:${item.kind}`)
    selectPlayback(item)
    setPlayRequest((current) => current + 1)
  }

  const playAudio = (job: AudioJob) => {
    if (job.status !== 'processing') requestPlayback({ jobId: job.id, kind: 'audio' })
  }

  const playbackTab = () => {
    const kind = selection()?.kind
    if (kind === 'performance') return 'perf' as const
    if (kind === 'score') return 'score' as const
    return undefined
  }

  return (
    <div class="flex-1 flex flex-col min-h-0 relative overflow-hidden">
      <header class="flex items-center justify-between gap-4 px-6 py-4 border-b border-white/10">
        <div class="min-w-0">
          <p class="text-base font-semibold text-text-primary">音频转 MIDI</p>
          <p class="text-xs text-text-secondary mt-1">逐个转录，失败任务自动跳过</p>
        </div>
        <div class="flex items-center gap-3 flex-shrink-0">
          <select
            value={backend()}
            disabled={running()}
            onChange={(event) => setBackend(event.currentTarget.value as 'transkun' | 'yourmt3')}
            class="h-9 px-3 rounded-lg border border-white/10 text-xs text-text-primary outline-none disabled:opacity-50"
            style={{ background: '#171522', color: '#f4f1ff', 'color-scheme': 'dark' }}
          >
            <option value="transkun" style={{ background: '#171522', color: '#f4f1ff' }}>独奏钢琴</option>
            <option value="yourmt3" style={{ background: '#171522', color: '#f4f1ff' }}>多乐器</option>
          </select>
          <div class="flex items-center gap-2 text-xs text-text-secondary" aria-label="输出 MIDI 类型">
            <label class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={includeScoreMidi()}
                disabled={running() || !includePerformanceMidi()}
                onChange={(event) => setIncludeScoreMidi(event.currentTarget.checked)}
                class="h-3.5 w-3.5 accent-accent"
              />
              乐谱版
            </label>
            <label class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={includePerformanceMidi()}
                disabled={running() || !includeScoreMidi()}
                onChange={(event) => setIncludePerformanceMidi(event.currentTarget.checked)}
                class="h-3.5 w-3.5 accent-accent"
              />
              演奏版
            </label>
          </div>
          <button
            type="button"
            onClick={runBatch}
            disabled={running() || queuedCount() === 0}
            class="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-accent text-white text-xs font-medium transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            <Show when={running()} fallback={<Play class="w-3.5 h-3.5" />}>
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
            </Show>
            {running() ? '正在转录' : `开始转录${queuedCount() > 0 ? ` (${queuedCount()})` : ''}`}
          </button>
        </div>
      </header>

      <main class="relative flex-1 min-h-0 overflow-hidden p-5">
        <div class="grid grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1 gap-5 h-full min-h-0 pb-20">
          <section class="min-w-0 min-h-0 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <FileAudio class="w-4 h-4 text-accent" />
                <h2 class="text-sm font-medium text-text-primary">音频文件</h2>
                <span class="text-xs text-text-secondary">{jobs().length}</span>
              </div>
              <button
                type="button"
                onClick={chooseFiles}
                class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
              >
                <Upload class="w-3.5 h-3.5" /> 添加
              </button>
            </div>

            <div class="flex-1 min-h-0 flex flex-col gap-1.5 overflow-y-auto pr-1">
              <For each={jobs()} fallback={<p class="py-6 text-center text-xs text-text-secondary">还没有添加音频文件，请点击右上角添加</p>}>
                {(job) => (
                  <div
                    onDblClick={() => playAudio(job)}
                    class="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer"
                    classList={{
                      'border-accent/50 bg-accent/10': selection()?.jobId === job.id && selection()?.kind === 'audio',
                      'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]': !(selection()?.jobId === job.id && selection()?.kind === 'audio'),
                      'opacity-60 cursor-default': job.status === 'processing',
                    }}
                  >
                    <FileAudio class="w-4 h-4 text-text-secondary flex-shrink-0" />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs text-text-primary">{job.name}</p>
                      <Show when={job.status === 'processing'}>
                        <div class="mt-1 h-1 bg-white/10 overflow-hidden">
                          <div class="h-full bg-accent transition-all" style={{ width: `${job.progress}%` }} />
                        </div>
                      </Show>
                      <Show when={job.status === 'failed'}>
                        <p class="truncate text-[11px] text-red-300 mt-1">{job.error}</p>
                      </Show>
                    </div>
                    <span class="text-[11px] text-text-secondary flex-shrink-0">
                      {job.status === 'queued' ? '待处理' : job.status === 'processing' ? `${job.progress}%` : job.status === 'completed' ? '已完成' : '失败'}
                    </span>
                    <Show when={job.status === 'completed'}>
                      <Check class="w-4 h-4 text-success flex-shrink-0" />
                    </Show>
                    <Show when={job.status === 'failed'}>
                      <button type="button" title="重试" onClick={(event) => { event.stopPropagation(); retryJob(job.id) }} class="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06]">
                        <RotateCcw class="w-3.5 h-3.5" />
                      </button>
                    </Show>
                    <Show when={job.status !== 'processing'}>
                      <button type="button" title="移除" onClick={(event) => { event.stopPropagation(); removeJob(job.id) }} class="p-1 rounded-md text-text-secondary hover:text-red-300 hover:bg-white/[0.06]">
                        <Trash2 class="w-3.5 h-3.5" />
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </section>

          <section class="min-w-0 min-h-0 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <FileMusic class="w-4 h-4 text-emerald-300" />
              <h2 class="text-sm font-medium text-text-primary">转录文件</h2>
              <span class="text-xs text-text-secondary">{outputFiles().length}</span>
            </div>
            <div class="flex-1 min-h-0 flex flex-col gap-1.5 overflow-y-auto pr-1">
              <For each={outputFiles()} fallback={<p class="py-6 text-center text-xs text-text-secondary">完成转录后，MIDI 文件会显示在这里</p>}>
                {(output) => {
                  const isSelected = () => selection()?.jobId === output.job.id && selection()?.kind === output.kind
                  return (
                    <button
                      type="button"
                      onDblClick={() => requestPlayback({ jobId: output.job.id, kind: output.kind })}
                      class="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border text-left transition-colors"
                      classList={{
                        'border-emerald-300/50 bg-emerald-300/10': isSelected(),
                        'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]': !isSelected(),
                      }}
                    >
                      <FileMusic class="w-4 h-4 text-emerald-300 flex-shrink-0" />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-xs text-text-primary">{output.name}</p>
                        <p class="truncate text-[11px] text-text-secondary mt-1">{output.kind === 'score' ? '乐谱版' : '演奏版'} · {output.job.name}</p>
                      </div>
                      <ChevronRight class="w-4 h-4 text-text-secondary flex-shrink-0" />
                    </button>
                  )
                }}
              </For>
            </div>
          </section>
        </div>

        <Show when={playbackKey()} keyed>
          <Show when={selectedJob()}>
            {(job) => (
              <section class="absolute bottom-4 left-5 right-5 z-10 rounded-xl border border-white/10 bg-bg-primary/95 px-4 py-2.5 pr-32 shadow-2xl backdrop-blur">
                <PlaybackPanel
                  audioUrl={job().audioUrl}
                  scoreMidiPath={job().midiPath}
                  perfMidiPath={job().perfMidiPath}
                  instruments={job().metadata?.instruments}
                  initialTab={playbackTab()}
                  compact
                  autoPlay={requestedSelection() === playbackSelectionKey()}
                  displayName={selectedOutput()?.name || job().name}
                />
                <Show when={selectedOutput()}>
                  {(output) => <div class="absolute right-3 top-1/2 -translate-y-1/2"><ExportBar inputName={output().name} midiPath={output().path} /></div>}
                </Show>
              </section>
            )}
          </Show>
        </Show>

        <Show when={notice()}>
          <div class="absolute bottom-20 left-0 right-0 flex items-center justify-center gap-2 text-xs text-text-secondary">
            <AlertCircle class="w-3.5 h-3.5" />
            {notice()}
          </div>
        </Show>
      </main>
    </div>
  )
}
