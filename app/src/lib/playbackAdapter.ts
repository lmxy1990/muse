import { invoke } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'

const preparedPaths = new Map<string, string>()
const playbackUrls = new Map<string, string>()

function mediaType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    case 'flac':
      return 'audio/flac'
    case 'm4a':
    case 'mp4':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'wma':
      return 'audio/x-ms-wma'
    default:
      return 'application/octet-stream'
  }
}

export function logPlayback(message: string) {
  void invoke('log_playback_event', { message }).catch(() => undefined)
}

export async function preparePlaybackPath(path: string): Promise<string> {
  const cached = preparedPaths.get(path)
  if (cached) return cached

  try {
    const prepared = await invoke<string>('prepare_playback_file', { path })
    preparedPaths.set(path, prepared)
    logPlayback(`adapter path ready: source=${path}; prepared=${prepared}`)
    return prepared
  } catch (error) {
    logPlayback(`adapter path failed: source=${path}; error=${String(error)}`)
    throw error
  }
}

export async function toPlaybackUrl(path: string): Promise<string> {
  const cached = playbackUrls.get(path)
  if (cached) return cached

  const prepared = await preparePlaybackPath(path)
  try {
    const bytes = await readFile(prepared)
    const url = URL.createObjectURL(new Blob([bytes], { type: mediaType(path) }))
    playbackUrls.set(path, url)
    logPlayback(`media blob ready: source=${path}; prepared=${prepared}`)
    return url
  } catch (error) {
    logPlayback(`media blob failed: source=${path}; prepared=${prepared}; error=${String(error)}`)
    throw error
  }
}

export async function readPlaybackBytes(path: string): Promise<Uint8Array> {
  const prepared = await preparePlaybackPath(path)
  try {
    return await readFile(prepared)
  } catch (error) {
    logPlayback(`MIDI read failed: prepared=${prepared}; error=${String(error)}`)
    throw error
  }
}
