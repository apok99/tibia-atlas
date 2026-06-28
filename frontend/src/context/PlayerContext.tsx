import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { TRACKS, type Track } from '../data/soundtrack'

type RepeatMode = 'off' | 'all' | 'one'

const VOLUME_KEY = 'tibia_atlas_volume'
const MUTED_KEY = 'tibia_atlas_muted'

type PlayerState = {
  tracks: Track[]
  current: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  playTrack: (id: number) => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  seek: (time: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
}

const PlayerContext = createContext<PlayerState | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
  }

  const [currentId, setCurrentId] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(() => {
    const saved = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '')
    return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.8
  })
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTED_KEY) === '1')
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')

  const current = useMemo(
    () => TRACKS.find((t) => t.id === currentId) ?? null,
    [currentId],
  )

  // Mirror the values the (one-shot) audio event handlers need into refs, so the
  // 'ended' handler always reads the latest state instead of a stale closure.
  const currentIdRef = useRef(currentId)
  const shuffleRef = useRef(shuffle)
  const repeatRef = useRef(repeat)
  useEffect(() => { currentIdRef.current = currentId }, [currentId])
  useEffect(() => { shuffleRef.current = shuffle }, [shuffle])
  useEffect(() => { repeatRef.current = repeat }, [repeat])

  // Keep volume/mute in sync with the audio element and persist them.
  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = muted ? 0 : volume
    localStorage.setItem(VOLUME_KEY, String(volume))
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
  }, [volume, muted])

  // Wire up audio element events exactly once; handlers read fresh state via refs.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setCurrentTime(audio.currentTime)
    const onMeta = () => setDuration(audio.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)

    const onEnded = () => {
      if (repeatRef.current === 'one') {
        audio.currentTime = 0
        audio.play().catch(() => {})
        return
      }
      const idx = TRACKS.findIndex((t) => t.id === currentIdRef.current)
      const isLast = idx === TRACKS.length - 1
      if (repeatRef.current === 'off' && isLast && !shuffleRef.current) {
        setIsPlaying(false)
        return
      }
      load(TRACKS[computeNextIndex()].id)
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Next track index based on the *current* shuffle/track refs.
  const computeNextIndex = () => {
    const id = currentIdRef.current
    if (id === null) return 0
    const idx = TRACKS.findIndex((t) => t.id === id)
    if (shuffleRef.current) {
      if (TRACKS.length <= 1) return idx
      let r = idx
      while (r === idx) r = Math.floor(Math.random() * TRACKS.length)
      return r
    }
    return (idx + 1) % TRACKS.length
  }

  const load = (id: number, autoplay = true) => {
    const audio = audioRef.current
    const track = TRACKS.find((t) => t.id === id)
    if (!audio || !track) return
    audio.src = track.src
    audio.load()
    setCurrentId(id)
    setCurrentTime(0)
    if (autoplay) audio.play().catch(() => {})
  }

  const playTrack = (id: number) => {
    const audio = audioRef.current
    if (!audio) return
    if (id === currentId) {
      togglePlay()
      return
    }
    load(id)
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (currentId === null) {
      load(TRACKS[0].id)
      return
    }
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  const next = () => load(TRACKS[computeNextIndex()].id)

  const prev = () => {
    const audio = audioRef.current
    if (!audio) return
    // Restart current track if we're more than 3s in (Spotify behaviour).
    if (audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    if (currentId === null) return
    const idx = TRACKS.findIndex((t) => t.id === currentId)
    const prevIdx = (idx - 1 + TRACKS.length) % TRACKS.length
    load(TRACKS[prevIdx].id)
  }

  const seek = (time: number) => {
    const audio = audioRef.current
    if (audio) {
      audio.currentTime = time
      setCurrentTime(time)
    }
  }

  const setVolume = (v: number) => {
    setVolumeState(v)
    if (v > 0 && muted) setMuted(false)
  }

  const toggleMute = () => setMuted((m) => !m)
  const toggleShuffle = () => setShuffle((s) => !s)
  const cycleRepeat = () =>
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))

  const value: PlayerState = {
    tracks: TRACKS,
    current,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    playTrack,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
  }

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}
