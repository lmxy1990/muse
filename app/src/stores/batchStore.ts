import { createMemo, createSignal } from 'solid-js'

export type AudioJobStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type OutputKind = 'score' | 'performance'

export interface AudioJob {
  id: string
  path: string
  name: string
  audioUrl: string
  status: AudioJobStatus
  progress: number
  error: string | null
  midiPath: string | null
  perfMidiPath: string | null
  metadata: BatchMetadata | null
}

export interface BatchMetadata {
  key: string
  timeSignature: number[]
  tempo: number
  instruments?: string[]
}

export interface PlaybackSelection {
  jobId: string
  kind: 'audio' | OutputKind
}

const [jobs, setJobs] = createSignal<AudioJob[]>([])
const [running, setRunning] = createSignal(false)
const [backend, setBackend] = createSignal<'transkun' | 'yourmt3'>('transkun')
const [selection, setSelection] = createSignal<PlaybackSelection | null>(null)

const completedCount = createMemo(() => jobs().filter((job) => job.status === 'completed').length)
const failedCount = createMemo(() => jobs().filter((job) => job.status === 'failed').length)
const queuedCount = createMemo(() => jobs().filter((job) => job.status === 'queued').length)

function makeId(path: string) {
  return `${path}:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

export function addAudioFiles(files: Array<{ path: string; name: string; audioUrl: string }>) {
  const existing = new Set(jobs().map((job) => job.path))
  const additions = files
    .filter((file) => !existing.has(file.path))
    .map((file): AudioJob => ({
      id: makeId(file.path),
      path: file.path,
      name: file.name,
      audioUrl: file.audioUrl,
      status: 'queued',
      progress: 0,
      error: null,
      midiPath: null,
      perfMidiPath: null,
      metadata: null,
    }))

  if (additions.length > 0) {
    setJobs((current) => [...current, ...additions])
  }
}

export function removeJob(id: string) {
  if (jobs().find((job) => job.id === id)?.status === 'processing') return
  setJobs((current) => current.filter((job) => job.id !== id))
  if (selection()?.jobId === id) setSelection(null)
}

export function clearCompleted() {
  setJobs((current) => current.filter((job) => job.status !== 'completed'))
  if (selection() && !jobs().some((job) => job.id === selection()!.jobId && job.status !== 'completed')) {
    setSelection(null)
  }
}

export function updateJob(id: string, update: Partial<AudioJob>) {
  setJobs((current) => current.map((job) => job.id === id ? { ...job, ...update } : job))
}

export function retryJob(id: string) {
  const job = jobs().find((item) => item.id === id)
  if (!job || job.status === 'processing') return
  updateJob(id, {
    status: 'queued',
    progress: 0,
    error: null,
    midiPath: null,
    perfMidiPath: null,
    metadata: null,
  })
}

export function selectPlayback(item: PlaybackSelection) {
  setSelection(item)
}

export const batchStore = {
  get jobs() { return jobs() },
  get running() { return running() },
  get backend() { return backend() },
  get selection() { return selection() },
  get completedCount() { return completedCount() },
  get failedCount() { return failedCount() },
  get queuedCount() { return queuedCount() },
}

export { jobs, running, backend, selection, completedCount, failedCount, queuedCount, setRunning, setBackend }
