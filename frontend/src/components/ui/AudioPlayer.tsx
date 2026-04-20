import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Languages } from 'lucide-react';

interface AudioPlayerProps {
  src: string;
  title?: string;
}

const BAR_COUNT = 48;

/* ---------- deterministic waveform generator ---------- */

const hashString = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const makeBars = (seedSource: string, count: number): number[] => {
  let seed = hashString(seedSource) || 1;
  const raw: number[] = [];
  for (let i = 0; i < count; i++) {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed >>>= 0;
    seed ^= seed << 5;
    seed >>>= 0;
    raw.push(22 + (seed % 79));
  }
  const smoothed = raw.map((_, i) => {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(raw.length - 1, i + 1)];
    return Math.round((a + b + c) / 3);
  });
  return smoothed;
};

const formatTime = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/* ---------- component ---------- */

type TranscribeState = 'idle' | 'loading' | 'done' | 'unavailable';

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, title }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcribeState, setTranscribeState] = useState<TranscribeState>('idle');
  const [transcript, setTranscript] = useState<string>('');

  const bars = useMemo(() => makeBars(src, BAR_COUNT), [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const handleLoaded = () => setDuration(audio.duration || 0);
    const handleTime = () => setCurrentTime(audio.currentTime || 0);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', handleLoaded);
    audio.addEventListener('timeupdate', handleTime);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoaded);
      audio.removeEventListener('timeupdate', handleTime);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [src]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const seekAtClientX = (clientX: number) => {
    const wave = waveRef.current;
    const audio = audioRef.current;
    if (!wave || !audio || !duration) return;
    const rect = wave.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
  };

  const handleWaveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    seekAtClientX(e.clientX);
  };

  const handleWaveKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    if (e.key === 'ArrowLeft') {
      audio.currentTime = Math.max(0, audio.currentTime - 3);
      setCurrentTime(audio.currentTime);
    } else if (e.key === 'ArrowRight') {
      audio.currentTime = Math.min(duration, audio.currentTime + 3);
      setCurrentTime(audio.currentTime);
    }
  };

  const handleTranscribe = async () => {
    if (transcribeState === 'loading') return;
    if (transcribeState === 'done' || transcribeState === 'unavailable') {
      setTranscribeState('idle');
      setTranscript('');
      return;
    }
    setTranscribeState('loading');
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { text?: string };
      setTranscript(data.text || '');
      setTranscribeState('done');
    } catch {
      setTranscript('Транскрибация пока недоступна — требуется STT-сервис на сервере.');
      setTranscribeState('unavailable');
    }
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const progressPct = Math.max(0, Math.min(1, progress)) * 100;

  return (
    <div className={`voice-player ${isPlaying ? 'is-playing' : ''}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        className="voice-player__btn"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
        aria-pressed={isPlaying}
      >
        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>

      <div className="voice-player__body">
        {title ? <div className="voice-player__title">{title}</div> : null}

        <div
          ref={waveRef}
          className="voice-player__wave"
          role="slider"
          tabIndex={0}
          aria-label="Перемотка"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPct)}
          aria-valuetext={`${formatTime(currentTime)} из ${formatTime(duration)}`}
          onClick={handleWaveClick}
          onKeyDown={handleWaveKey}
          style={{ '--voice-progress': `${progressPct}%` } as React.CSSProperties}
        >
          <div className="voice-player__wave-layer voice-player__wave-layer--base" aria-hidden>
            {bars.map((h, i) => (
              <span
                key={`b-${i}`}
                className="voice-player__bar"
                style={{ '--h': `${h}%` } as React.CSSProperties}
              />
            ))}
          </div>
          <div className="voice-player__wave-layer voice-player__wave-layer--fill" aria-hidden>
            {bars.map((h, i) => (
              <span
                key={`f-${i}`}
                className="voice-player__bar"
                style={{ '--h': `${h}%` } as React.CSSProperties}
              />
            ))}
          </div>
          <span className="voice-player__thumb" aria-hidden />
        </div>

        <div className="voice-player__meta-row">
          <span className="voice-player__time">
            {formatTime(currentTime)}
            {!isPlaying && currentTime === 0 && <span className="voice-player__unread-dot" />}
          </span>
        </div>

        {transcribeState !== 'idle' && (
          <div
            className={`voice-player__transcript voice-player__transcript--${transcribeState}`}
            aria-live="polite"
          >
            {transcribeState === 'loading' ? 'Распознаём…' : transcript}
          </div>
        )}
      </div>

      <button
        type="button"
        className={`voice-player__transcribe ${transcribeState !== 'idle' ? 'is-active' : ''}`}
        onClick={handleTranscribe}
        aria-label="Транскрибация"
        title="Транскрибация"
      >
        <Languages size={14} strokeWidth={2} />
      </button>
    </div>
  );
};
