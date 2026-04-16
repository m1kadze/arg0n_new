import React, { useEffect, useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';

interface RecordingBarProps {
  stream: MediaStream | null;
  onCancel: () => void;
  onSend: () => void;
}

const BAR_COUNT = 40;
const NOISE_FLOOR = 0.04;
const SMOOTHING = 0.55;

const formatElapsed = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

/**
 * Telegram-style recording bar.
 * — Live waveform rendered from MediaStream via AnalyserNode + rAF
 *   (bar heights written directly to DOM to avoid per-frame React renders)
 * — Pulsing red dot + monotype timer
 * — Cancel / Send actions
 */
export const RecordingBar: React.FC<RecordingBarProps> = ({
  stream,
  onCancel,
  onSend,
}) => {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const heightsRef = useRef<number[]>(new Array(BAR_COUNT).fill(NOISE_FLOOR));
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  const [elapsed, setElapsed] = useState(0);

  // Timer tick (0.25s feels smoother than 1s in monotype)
  useEffect(() => {
    startedAtRef.current = Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    return () => window.clearInterval(interval);
  }, []);

  // Audio analyser + rAF loop
  useEffect(() => {
    if (!stream) return undefined;

    const AudioCtor: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtor) return undefined;

    const ctx = new AudioCtor();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    ctxRef.current = ctx;
    analyserRef.current = analyser;
    dataRef.current = data;

    // Average the lower half of the spectrum — voice energy lives there
    const voiceBins = Math.floor(analyser.frequencyBinCount * 0.55);
    const binsPerBar = Math.max(1, Math.floor(voiceBins / BAR_COUNT));

    const tick = () => {
      analyser.getByteFrequencyData(data);

      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        for (let j = 0; j < binsPerBar; j++) {
          sum += data[i * binsPerBar + j] || 0;
        }
        const avg = sum / binsPerBar / 255; // 0..1
        // Boost low values so quiet speech is still visible
        const shaped = Math.pow(avg, 0.7);
        const prev = heightsRef.current[i];
        const next = prev * SMOOTHING + shaped * (1 - SMOOTHING);
        heightsRef.current[i] = Math.max(NOISE_FLOOR, next);

        const bar = barsRef.current[i];
        if (bar) {
          // writes transform directly — hardware-accelerated, no React render
          bar.style.transform = `scaleY(${heightsRef.current[i].toFixed(3)})`;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        source.disconnect();
      } catch {
        /* noop */
      }
      ctx.close().catch(() => undefined);
    };
  }, [stream]);

  return (
    <div className="rec-bar" role="region" aria-label="Запись голосового сообщения">
      <button
        type="button"
        className="rec-bar__cancel"
        onClick={onCancel}
        title="Отменить запись"
        aria-label="Отменить запись"
      >
        <Trash2 size={18} />
      </button>

      <div className="rec-bar__status">
        <span className="rec-bar__dot" aria-hidden />
        <span className="rec-bar__timer">{formatElapsed(elapsed)}</span>
      </div>

      <div className="rec-bar__wave" aria-hidden>
        {Array.from({ length: BAR_COUNT }).map((_, i) => (
          <span
            key={i}
            className="rec-bar__wave-bar"
            ref={(el) => {
              barsRef.current[i] = el;
            }}
            style={{ '--i': i } as React.CSSProperties}
          />
        ))}
      </div>

      <button
        type="button"
        className="rec-bar__send"
        onClick={onSend}
        title="Отправить"
        aria-label="Отправить голосовое сообщение"
      >
        <Send size={18} />
      </button>
    </div>
  );
};
