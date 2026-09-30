type StopPlayback = () => void

interface ActivePlayback {
  stop: StopPlayback
}

let activePlayback: ActivePlayback | null = null

/**
 * Claim the shared audio output for one source. Starting another source
 * immediately silences the previous one, including sources in another panel.
 */
export function claimPlayback(stop: StopPlayback): () => void {
  const previous = activePlayback
  activePlayback = null

  const current: ActivePlayback = { stop }
  try {
    previous?.stop()
  } finally {
    activePlayback = current
  }
  return () => {
    if (activePlayback === current) activePlayback = null
  }
}

export function stopActivePlayback() {
  const current = activePlayback
  activePlayback = null
  current?.stop()
}
