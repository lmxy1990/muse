import { createSignal, Show, For, onMount, onCleanup } from 'solid-js'
import WaveSurfer from 'wavesurfer.js'
import { MidiSynth } from '../lib/midiSynth'
import { logPlayback } from '../lib/playbackAdapter'
import { claimPlayback } from '../lib/playbackManager'
import { Play, Pause, SkipBack, SkipForward, Music, Volume2 } from 'lucide-solid'

type Tab = 'original' | 'perf' | 'score'

interface PlaybackPanelProps {
  audioUrl: string | null
  scoreMidiPath: string | null
  perfMidiPath: string | null
  instruments?: string[]
  initialTab?: Tab
  compact?: boolean
  autoPlay?: boolean
  displayName?: string
}

const TRACK_COLORS = [
  '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#a855f7', '#06b6d4', '#e11d48',
]

const TAB_COLOR: Record<Tab, string> = {
  original: '#8b5cf6',
  perf: '#f59e0b',
  score: '#10b981',
}

const TAB_LABEL: Record<Tab, string> = {
  original: '原音',
  perf: '演奏版',
  score: '乐谱版',
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function PlaybackPanel(props: PlaybackPanelProps) {
  let waveformRef: HTMLDivElement | undefined
  let audioRef: HTMLAudioElement | undefined
  let audioCleanup: (() => void) | undefined
  let ws: WaveSurfer | undefined

  const perfSynth = new MidiSynth()
  const scoreSynth = new MidiSynth()

  const availableTabs = (): Tab[] => {
    const tabs: Tab[] = []
    if (props.audioUrl) tabs.push('original')
    if (props.perfMidiPath) tabs.push('perf')
    if (props.scoreMidiPath) tabs.push('score')
    return tabs
  }

  const defaultTab = () => props.initialTab || (props.audioUrl
    ? 'original' as Tab
    : props.scoreMidiPath
      ? 'score' as Tab
      : props.perfMidiPath
        ? 'perf' as Tab
        : 'original' as Tab)
  const [activeTab, setActiveTab] = createSignal<Tab>(defaultTab())

  const [playing, setPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [volume, setVolume] = createSignal(0.8)

  const [perfLoaded, setPerfLoaded] = createSignal(false)
  const [scoreLoaded, setScoreLoaded] = createSignal(false)
  const [perfError, setPerfError] = createSignal<string | null>(null)
  const [scoreError, setScoreError] = createSignal<string | null>(null)
  const [playError, setPlayError] = createSignal<string | null>(null)

  const [scoreTrackEnabled, setScoreTrackEnabled] = createSignal<boolean[]>([])
  const [scoreTrackNames, setScoreTrackNames] = createSignal<string[]>([])
  const [scoreTrackCounts, setScoreTrackCounts] = createSignal<number[]>([])

  const [wsReady, setWsReady] = createSignal(false)
  const [audioReady, setAudioReady] = createSignal(false)
  let wsDuration = 0
  let releasePlaybackClaim: (() => void) | undefined

  const syncWaveformCursor = (midiTime: number) => {
    if (!ws || wsDuration <= 0) return
    const ratio = Math.max(0, Math.min(1, midiTime / wsDuration))
    ws.seekTo(ratio)
  }

  const clearPlaybackClaim = () => {
    releasePlaybackClaim?.()
    releasePlaybackClaim = undefined
  }

  const claimCurrentPlayback = () => {
    clearPlaybackClaim()
    const release = claimPlayback(stopAll)
    releasePlaybackClaim = release
    return release
  }

  const releaseIfCurrent = (release: () => void) => {
    if (releasePlaybackClaim === release) {
      release()
      releasePlaybackClaim = undefined
    }
  }

  onMount(() => {
    if (props.compact) {
      const audio = audioRef
      if (audio && props.audioUrl) {
        const onLoadedMetadata = () => {
          setAudioReady(true)
          setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
          if (props.autoPlay) {
            audio.volume = volume()
            const release = claimCurrentPlayback()
            void audio.play().catch((error: any) => {
              releaseIfCurrent(release)
              logPlayback(`media autoplay failed: src=${audio.currentSrc}; error=${error?.message || String(error)}`)
              setPlayError(error?.message || '原音播放失败')
            })
          }
        }
        const onTimeUpdate = () => setCurrentTime(audio.currentTime)
        const onPlay = () => setPlaying(true)
        const onPause = () => setPlaying(false)
        const onEnded = () => {
          setPlaying(false)
          setCurrentTime(0)
          clearPlaybackClaim()
        }
        const onError = () => {
          const mediaError = audio.error
          logPlayback(`media load failed: src=${audio.currentSrc}; code=${mediaError?.code || 'unknown'}; message=${mediaError?.message || 'unknown'}`)
          setPlayError('原音加载失败，请检查音频文件')
        }

        audio.addEventListener('loadedmetadata', onLoadedMetadata)
        audio.addEventListener('timeupdate', onTimeUpdate)
        audio.addEventListener('play', onPlay)
        audio.addEventListener('pause', onPause)
        audio.addEventListener('ended', onEnded)
        audio.addEventListener('error', onError)
        audio.load()
        audioCleanup = () => {
          audio.pause()
          audio.removeEventListener('loadedmetadata', onLoadedMetadata)
          audio.removeEventListener('timeupdate', onTimeUpdate)
          audio.removeEventListener('play', onPlay)
          audio.removeEventListener('pause', onPause)
          audio.removeEventListener('ended', onEnded)
          audio.removeEventListener('error', onError)
        }
      }
    } else if (waveformRef) {
      ws = WaveSurfer.create({
        container: waveformRef,
        waveColor: 'rgba(139, 92, 246, 0.3)',
        progressColor: 'rgba(139, 92, 246, 0.7)',
        cursorColor: '#8b5cf6',
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: props.compact ? 32 : 56,
        normalize: true,
      })
      if (props.audioUrl) ws.load(props.audioUrl)
      ws.on('ready', () => {
        setWsReady(true)
        wsDuration = ws!.getDuration()
        if (activeTab() === 'original') setDuration(wsDuration)
        if (props.autoPlay && activeTab() === 'original') {
          ws!.setVolume(volume())
          const release = claimCurrentPlayback()
          void ws!.play().catch((error: any) => {
            releaseIfCurrent(release)
            setPlayError(error?.message || '原音播放失败')
          })
        }
      })
      ws.on('error', (error: any) => setPlayError(error?.message || String(error)))
      ws.on('audioprocess', (t: number) => {
        if (activeTab() === 'original') setCurrentTime(t)
      })
      ws.on('seeking', (t: number) => {
        if (activeTab() === 'original') setCurrentTime(t)
      })
      ws.on('play', () => {
        if (activeTab() === 'original') setPlaying(true)
      })
      ws.on('pause', () => {
        if (activeTab() === 'original') setPlaying(false)
      })
      ws.on('finish', () => {
        if (activeTab() === 'original') setPlaying(false)
        clearPlaybackClaim()
      })
    }

    if (props.perfMidiPath) {
      perfSynth.loadFile(props.perfMidiPath).then(() => {
        setPerfLoaded(true)
        perfSynth.setOnTimeUpdate((t) => {
          if (activeTab() === 'perf') {
            setCurrentTime(t)
            syncWaveformCursor(t)
          }
        })
        perfSynth.setOnEnd(() => {
          if (activeTab() === 'perf') {
            setPlaying(false)
            setCurrentTime(0)
            syncWaveformCursor(0)
            clearPlaybackClaim()
          }
        })
        void MidiSynth.preloadInstruments(perfSynth.parsed.tracks.map((t) => t.program)).catch(() => undefined)
        if (activeTab() === 'perf') setDuration(perfSynth.duration)
        if (props.autoPlay && activeTab() === 'perf') void togglePlay()
      }).catch((e: any) => {
        logPlayback(`performance MIDI load failed: path=${props.perfMidiPath}; error=${e?.message || String(e)}`)
        setPerfError(e?.message || String(e))
      })
    }

    if (props.scoreMidiPath) {
      scoreSynth.loadFile(props.scoreMidiPath).then(() => {
        setScoreLoaded(true)
        setScoreTrackNames(scoreSynth.parsed.tracks.map((t) => t.name))
        setScoreTrackCounts(scoreSynth.parsed.tracks.map((t) => t.noteCount))
        setScoreTrackEnabled(scoreSynth.parsed.tracks.map(() => true))
        scoreSynth.setOnTimeUpdate((t) => {
          if (activeTab() === 'score') {
            setCurrentTime(t)
            syncWaveformCursor(t)
          }
        })
        scoreSynth.setOnEnd(() => {
          if (activeTab() === 'score') {
            setPlaying(false)
            setCurrentTime(0)
            syncWaveformCursor(0)
            clearPlaybackClaim()
          }
        })
        void MidiSynth.preloadInstruments(scoreSynth.parsed.tracks.map((t) => t.program)).catch(() => undefined)
        if (activeTab() === 'score') setDuration(scoreSynth.duration)
        if (props.autoPlay && activeTab() === 'score') void togglePlay()
      }).catch((e: any) => {
        logPlayback(`score MIDI load failed: path=${props.scoreMidiPath}; error=${e?.message || String(e)}`)
        setScoreError(e?.message || String(e))
      })
    }
  })

  onCleanup(() => {
    stopAll()
    audioCleanup?.()
    ws?.destroy()
    perfSynth.dispose()
    scoreSynth.dispose()
  })

  const pauseAll = () => {
    audioRef?.pause()
    ws?.pause()
    if (perfSynth.playing) perfSynth.pause()
    if (scoreSynth.playing) scoreSynth.pause()
    setPlaying(false)
    clearPlaybackClaim()
  }

  const stopAll = () => {
    audioRef?.pause()
    ws?.pause()
    perfSynth.stop()
    scoreSynth.stop()
    setPlaying(false)
    clearPlaybackClaim()
  }

  const switchTab = (tab: Tab) => {
    if (tab === activeTab()) return
    pauseAll()
    setActiveTab(tab)
    if (tab === 'original' && ws) {
      setCurrentTime(ws.getCurrentTime())
      setDuration(ws.getDuration())
    } else if (tab === 'perf' && perfLoaded()) {
      setCurrentTime(perfSynth.getCurrentTime())
      setDuration(perfSynth.duration)
      syncWaveformCursor(perfSynth.getCurrentTime())
    } else if (tab === 'score' && scoreLoaded()) {
      setCurrentTime(scoreSynth.getCurrentTime())
      setDuration(scoreSynth.duration)
      syncWaveformCursor(scoreSynth.getCurrentTime())
    }
  }

  const activeSynth = () => activeTab() === 'perf' ? perfSynth : scoreSynth

  const seekToTime = (requestedTime: number) => {
    const total = duration()
    const time = Math.max(0, Math.min(total > 0 ? total : requestedTime, requestedTime))
    const tab = activeTab()

    if (tab === 'original') {
      if (props.compact && audioRef) {
        audioRef.currentTime = time
        setCurrentTime(time)
      } else if (ws) {
        const waveDuration = ws.getDuration()
        if (waveDuration > 0) ws.seekTo(time / waveDuration)
        setCurrentTime(time)
      }
      return
    }

    const synth = activeSynth()
    synth.seekTo(time)
    setCurrentTime(time)
    syncWaveformCursor(time)
  }

  const handleProgressInput = (event: InputEvent) => {
    seekToTime(Number((event.currentTarget as HTMLInputElement).value))
  }

  const handleWaveformClick = (e: MouseEvent) => {
    const tab = activeTab()
    if (tab === 'original' || !waveformRef) return
    const rect = waveformRef!.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seekToTime(pct * activeSynth().duration)
  }

  const togglePlay = async () => {
    setPlayError(null)
    const tab = activeTab()
    if (playing()) {
      pauseAll()
      return
    }
    if (tab === 'original') {
      if (props.compact && audioRef) {
        audioRef.volume = volume()
        if (audioRef.paused) {
          const release = claimCurrentPlayback()
          try {
            await audioRef.play()
          } catch (error: any) {
            releaseIfCurrent(release)
            logPlayback(`media play failed: src=${audioRef.currentSrc}; error=${error?.message || String(error)}`)
            setPlayError(error?.message || '原音播放失败')
          }
        } else {
          audioRef.pause()
        }
      } else if (ws) {
        ws.setVolume(volume())
        if (ws.isPlaying()) {
          pauseAll()
        } else {
          const release = claimCurrentPlayback()
          try {
            await ws.play()
            if (releasePlaybackClaim !== release) return
          } catch (error: any) {
            releaseIfCurrent(release)
            setPlayError(error?.message || '原音播放失败')
          }
        }
      }
    } else {
      const synth = activeSynth()
      const release = claimCurrentPlayback()
      synth.initAudioContext()
      try {
        await synth.play(synth.getCurrentTime())
      } catch (error: any) {
        releaseIfCurrent(release)
        logPlayback(`MIDI play failed: tab=${tab}; error=${error?.message || String(error)}`)
        setPlayError(error?.message || '音色加载失败，请检查网络连接后重试')
        return
      }
      if (releasePlaybackClaim !== release || !synth.playing) return
      synth.setVolume(volume())
      if (tab === 'score') {
        scoreTrackEnabled().forEach((enabled, i) => synth.setTrackEnabled(i, enabled))
      }
      setPlaying(true)
    }
  }

  const skipBack = () => {
    const tab = activeTab()
    if (tab === 'original' && ws) {
      ws.skip(-5)
    } else {
      const synth = activeSynth()
      const t = Math.max(0, currentTime() - 5)
      synth.seekTo(t)
      setCurrentTime(t)
      syncWaveformCursor(t)
    }
  }

  const skipForward = () => {
    const tab = activeTab()
    if (tab === 'original' && ws) {
      ws.skip(5)
    } else {
      const synth = activeSynth()
      const t = Math.min(duration(), currentTime() + 5)
      synth.seekTo(t)
      setCurrentTime(t)
      syncWaveformCursor(t)
    }
  }

  const toggleTrack = (index: number) => {
    const current = scoreTrackEnabled()
    const updated = [...current]
    updated[index] = !updated[index]
    setScoreTrackEnabled(updated)
    scoreSynth.setTrackEnabled(index, updated[index])
  }

  const color = () => TAB_COLOR[activeTab()]

  const isReady = () => {
    const tab = activeTab()
    if (tab === 'original') return props.compact ? audioReady() : wsReady()
    if (tab === 'perf') return perfLoaded()
    return scoreLoaded()
  }

  const activeError = () => {
    const tab = activeTab()
    if (tab === 'perf') return perfError()
    if (tab === 'score') return scoreError()
    return null
  }

  const loading = () => {
    const tab = activeTab()
    if (tab === 'original') return props.compact ? !audioReady() : !wsReady()
    if (tab === 'perf') return !perfLoaded()
    return !scoreLoaded()
  }

  const showTracks = () => activeTab() === 'score' && scoreTrackNames().length > 1

  const updateVolume = (event: InputEvent) => {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    setVolume(value)
    if (audioRef) audioRef.volume = value
    ws?.setVolume(value)
    perfSynth.setVolume(value)
    scoreSynth.setVolume(value)
  }

  const progressPercent = () => duration() > 0
    ? Math.min(100, Math.max(0, currentTime() / duration() * 100))
    : 0

  const renderProgressBar = () => (
    <div class="relative h-3 w-full" title="点击或拖动调整播放进度">
      <div class="absolute left-0 right-0 top-1 h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          class="h-full rounded-full transition-[width] duration-100"
          style={{ width: `${progressPercent()}%`, background: color() }}
        />
      </div>
      <input
        type="range"
        min="0"
        max={Math.max(1, duration())}
        step="0.01"
        value={Math.min(currentTime(), duration())}
        onInput={handleProgressInput}
        disabled={!isReady() || duration() <= 0 || !!activeError()}
        class="absolute inset-0 h-3 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        aria-label="播放进度"
      />
    </div>
  )

  const playbackStatus = () => {
    if (activeError() || playError()) return '播放失败'
    if (loading()) return '加载中'
    return playing() ? '正在播放' : '已暂停'
  }

  if (props.compact) {
    return (
      <div class="relative flex items-center gap-3 w-full min-w-0 pb-4">
        <Show when={props.audioUrl}>
          <audio ref={audioRef} src={props.audioUrl || undefined} preload="metadata" class="hidden" />
        </Show>
        <button
          type="button"
          onClick={() => void togglePlay()}
          disabled={!isReady() || !!activeError()}
          title={playing() ? '暂停' : '播放'}
          class="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-40"
          style={{ background: color() }}
        >
          {playing() ? <Pause class="w-4 h-4 text-white" /> : <Play class="w-4 h-4 text-white ml-0.5" />}
        </button>
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-medium text-text-primary">{props.displayName || '未选择文件'}</p>
          <p class="text-[11px] text-text-secondary mt-0.5">{playbackStatus()}</p>
        </div>
        <Show when={activeError() || playError()}>
          <span class="hidden sm:block max-w-52 truncate text-[11px] text-red-300" title={activeError() || playError() || ''}>
            {activeError() || playError()}
          </span>
        </Show>
        <label class="flex items-center gap-2 flex-shrink-0" title="音量">
          <Volume2 class="w-4 h-4 text-text-secondary" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume()}
            onInput={updateVolume}
            class="w-20 sm:w-28 accent-accent"
            aria-label="音量"
          />
        </label>
        <div class="absolute left-0 right-0 bottom-0">
          {renderProgressBar()}
        </div>
      </div>
    )
  }

  return (
    <div class={`flex flex-col ${props.compact ? 'gap-2' : 'gap-5'} w-full max-w-lg mx-auto`}>
      <div class="flex items-center justify-center">
        <div class="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <For each={availableTabs()}>
            {(tab) => (
              <button
                onClick={() => switchTab(tab)}
                class={`px-4 ${props.compact ? 'py-1' : 'py-1.5'} rounded-lg text-sm font-medium transition-all`}
                style={{
                  background: activeTab() === tab ? `${TAB_COLOR[tab]}20` : 'transparent',
                  color: activeTab() === tab ? TAB_COLOR[tab] : 'rgba(255,255,255,0.4)',
                }}
              >
                {TAB_LABEL[tab]}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={activeError() || playError()}>
        <div class="text-red-400 text-xs text-center">
          {activeError() ? `MIDI 加载失败：${activeError()}` : `播放失败：${playError()}`}
        </div>
      </Show>

      <Show when={props.audioUrl}>
        <div class="w-full" onClick={handleWaveformClick}>
          <div
            ref={waveformRef}
            class="w-full rounded-xl overflow-hidden transition-opacity duration-200"
            style={{ opacity: wsReady() ? 1 : 0.3 }}
          />
        </div>
      </Show>

      <div class={`flex items-center justify-between text-xs text-text-secondary px-1 ${props.compact ? '-mt-1' : '-mt-3'}`}>
        <span>{formatTime(currentTime())}</span>
        <span>{formatTime(duration())}</span>
      </div>

      {renderProgressBar()}

      <div class={`flex items-center ${props.compact ? 'gap-4' : 'gap-6'} justify-center`}>
        <button onClick={skipBack} class="p-2 rounded-full transition-colors hover:bg-white/5">
          <SkipBack class="w-5 h-5 text-text-secondary" />
        </button>
        <button
          onClick={togglePlay}
          disabled={!isReady() || !!activeError()}
          class={`${props.compact ? 'w-10 h-10' : 'w-14 h-14'} rounded-full flex items-center justify-center transition-colors disabled:opacity-40`}
          style={{ background: color() }}
        >
          {playing()
            ? <Pause class={`${props.compact ? 'w-5 h-5' : 'w-6 h-6'} text-white`} />
            : <Play class={`${props.compact ? 'w-5 h-5' : 'w-6 h-6'} text-white ml-0.5`} />
          }
        </button>
        <button onClick={skipForward} class="p-2 rounded-full transition-colors hover:bg-white/5">
          <SkipForward class="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <Show when={loading() && !activeError()}>
        <span class="text-xs text-text-secondary text-center">
          {activeTab() === 'original' ? '正在加载原音...' : '正在加载 MIDI 音色...'}
        </span>
      </Show>

      <div
        class="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ 'grid-template-rows': showTracks() ? '1fr' : '0fr' }}
      >
        <div class="overflow-hidden">
          <div class="flex items-center justify-center gap-1.5 flex-wrap pt-1">
            <For each={scoreTrackNames()}>
              {(name, i) => (
                <button
                  onClick={() => toggleTrack(i())}
                  class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                  style={{
                    background: scoreTrackEnabled()[i()] ? `${TRACK_COLORS[i()]}20` : 'rgba(255,255,255,0.03)',
                    color: scoreTrackEnabled()[i()] ? TRACK_COLORS[i()] : 'rgba(255,255,255,0.3)',
                  }}
                >
                  <Music style={{ width: '12px', height: '12px' }} />
                  {name}
                  <span style={{ opacity: 0.6 }}>({scoreTrackCounts()[i()]})</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}
