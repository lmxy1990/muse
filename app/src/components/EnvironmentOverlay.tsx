import { Show } from 'solid-js'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-solid'
import type { EnvironmentStatus } from '../stores/environmentStore'

interface EnvironmentOverlayProps {
  status: EnvironmentStatus
  onRetry: () => void
}

export default function EnvironmentOverlay(props: EnvironmentOverlayProps) {
  const failed = () => Boolean(props.status.error)

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(8, 8, 18, 0.94)' }}>
      <div class="w-full max-w-md glass rounded-2xl p-7 flex flex-col items-center gap-5 text-center">
        <Show when={!failed()} fallback={<AlertCircle class="w-12 h-12 text-red-400" />}>
          <Loader2 class="w-12 h-12 text-accent animate-spin" />
        </Show>

        <div class="flex flex-col gap-2">
          <h2 class="text-lg font-semibold text-text-primary">
            {failed() ? '本地环境部署失败' : '正在准备本地环境'}
          </h2>
          <Show when={!failed()}>
            <p class="text-sm text-text-secondary">首次启动需要安装 Python 依赖和转录模型，请稍候。</p>
          </Show>
          <Show when={failed()}>
            <p class="text-sm text-red-300 break-words">{props.status.error}</p>
          </Show>
        </div>

        <Show when={!failed()}>
          <div class="w-full flex flex-col gap-2">
            <div class="h-2 rounded-full bg-white/10 overflow-hidden">
              <div class="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${props.status.percent}%` }} />
            </div>
            <span class="text-xs text-text-secondary">{props.status.percent}%</span>
          </div>
        </Show>

        <div class="w-full text-left text-xs text-text-secondary/70 break-all">
          <span>部署日志：</span>
          <code>{props.status.log_path || '尚未生成'}</code>
        </div>

        <Show when={failed()}>
          <button
            onClick={props.onRetry}
            class="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent/80 text-white text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw class="w-4 h-4" />
            重试部署
          </button>
        </Show>
      </div>
    </div>
  )
}
