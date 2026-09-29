import { Show, onCleanup, createSignal, createEffect } from 'solid-js'
import { stage, percent, error } from '../stores/pipelineStore'
import { resetApp, backend } from '../stores/appStore'
import ProgressSteps from '../components/ProgressSteps'
import WavefieldBackground from '../components/WavefieldBackground'
import { Loader2, AlertCircle } from 'lucide-solid'

const STAGE_HEADINGS: Record<string, string> = {
  setup: '正在准备本地环境...',
  separating: '正在分离钢琴...',
  transcribing: '正在转录...',
  quantizing: '正在量化节奏...',
  loading_model: '正在加载模型...',
  preparing_audio: '正在准备音频...',
  extracting_notes: '正在提取音符...',
  writing_midi: '正在生成 MIDI...',
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function ProcessingView() {
  const [elapsed, setElapsed] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    const s = stage()
    if (s && s !== 'done') {
      if (!timer) {
        setElapsed(0)
        timer = setInterval(() => setElapsed((e) => e + 1), 1000)
      }
    } else if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  const heading = () => STAGE_HEADINGS[stage() || ''] || '正在转录...'

  return (
    <div class="flex-1 flex flex-col items-center justify-center gap-8 p-8 animate-fade-in relative">
      <Show when={!error()} fallback={
        <div class="flex flex-col items-center gap-6">
          <div class="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center">
            <AlertCircle class="w-8 h-8 text-red-400" />
          </div>
          <div class="text-center max-w-md">
            <p class="text-lg font-medium mb-2">处理失败</p>
            <p class="text-sm text-text-secondary">{error()}</p>
          </div>
          <button
            onClick={resetApp}
            class="px-6 py-2.5 rounded-xl glass glass-hover text-sm font-medium transition-colors"
          >
            重试
          </button>
        </div>
      }>
        <WavefieldBackground />

        <div class="flex flex-col items-center gap-6 min-w-[320px] relative z-10">
          <Loader2 class="w-10 h-10 text-accent animate-spin" />

          <div class="text-center">
            <p class="text-lg font-medium mb-1">{heading()}</p>
            <div class="w-48 h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                class="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${percent()}%` }}
              />
            </div>
            <p class="text-xs text-text-secondary mt-2">
              {percent()}%
              <Show when={elapsed() > 0}>
                {' '}&middot; 已用时 {formatElapsed(elapsed())}
              </Show>
            </p>
          </div>
        </div>

        <div class="relative z-10">
          <ProgressSteps currentStage={stage()} backend={backend()} />
        </div>
      </Show>
    </div>
  )
}
