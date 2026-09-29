import { For } from 'solid-js'
import { Check } from 'lucide-solid'
import type { Backend } from '../stores/appStore'

interface Stage {
  id: string
  label: string
}

const TRANSKUN_STAGES: Stage[] = [
  { id: 'setup', label: '准备本地环境' },
  { id: 'separating', label: '分离钢琴音轨' },
  { id: 'transcribing', label: '转录音符' },
  { id: 'quantizing', label: '量化节奏' },
]

const YOURMT3_STAGES: Stage[] = [
  { id: 'setup', label: '准备本地环境' },
  { id: 'loading_model', label: '加载转录模型' },
  { id: 'preparing_audio', label: '准备音频' },
  { id: 'transcribing', label: '转录乐器' },
  { id: 'extracting_notes', label: '提取音符' },
  { id: 'writing_midi', label: '生成 MIDI' },
]

function stageOrder(backend: Backend): string[] {
  if (backend === 'yourmt3') return ['setup', 'loading_model', 'preparing_audio', 'transcribing', 'extracting_notes', 'writing_midi', 'done']
  return ['setup', 'separating', 'transcribing', 'quantizing', 'done']
}

interface ProgressStepsProps {
  currentStage: string | null
  backend?: Backend
}

export default function ProgressSteps(props: ProgressStepsProps) {
  const backend = () => props.backend || 'transkun'
  const stages = () => backend() === 'yourmt3' ? YOURMT3_STAGES : TRANSKUN_STAGES
  const order = () => stageOrder(backend())
  const currentIndex = () => order().indexOf(props.currentStage || '')

  return (
    <div class="flex flex-col gap-3">
      <For each={stages()}>
        {(step) => {
          const stepIndex = () => order().indexOf(step.id)
          const isComplete = () => currentIndex() > stepIndex()
          const isCurrent = () => props.currentStage === step.id

          return (
            <div class="flex items-center gap-3">
              <div class={`
                w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all
                ${isComplete()
                  ? 'bg-success text-white'
                  : isCurrent()
                    ? 'bg-accent text-white'
                    : 'bg-white/10 text-text-secondary'
                }
              `}>
                {isComplete()
                  ? <Check class="w-3.5 h-3.5" />
                  : isCurrent()
                    ? <div class="w-2 h-2 rounded-full bg-white animate-pulse" />
                    : <div class="w-2 h-2 rounded-full bg-current opacity-50" />
                }
              </div>
              <span class={`text-sm transition-colors ${
                isComplete() ? 'text-success' : isCurrent() ? 'text-text-primary' : 'text-text-secondary'
              }`}>
                {step.label}
              </span>
            </div>
          )
        }}
      </For>
    </div>
  )
}
