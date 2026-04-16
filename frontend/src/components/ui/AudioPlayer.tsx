import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

const formatTime = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '00:00';
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

interface AudioPlayerProps {
  src: string;
  title?: string;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, title }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleLoaded = () => setDuration(audio.duration || 0);
    const handleTime = () => setCurrentTime(audio.currentTime || 0);
    const handleEnded = () => setIsPlaying(false);

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
    if (!audio) {
      return;
    }

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

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const value = Number(event.target.value);
    audio.currentTime = value;
    setCurrentTime(value);
  };

  return (
    <div className="audio-player">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" className="audio-control" onClick={togglePlay}>
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="audio-info">
        {title && <div className="audio-title">{title}</div>}
        <div className="audio-progress">
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            onChange={handleSeek}
          />
          <div className="audio-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>
      </div>
    </div>
  );
};