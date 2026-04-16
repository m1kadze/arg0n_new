import { useCallback, useEffect, useRef, useState } from 'react';
import { buildApiUrl, getAuthToken } from '../core/api';

type IncomingCall = {
  chatId: number;
  fromUserId: number;
  callType: 'voice' | 'video';
  sdp: RTCSessionDescriptionInit;
};

const buildWsUrl = (path: string): string => {
  const httpUrl = buildApiUrl(path);
  return httpUrl.replace(/^http/, 'ws');
};

export function useCalls(
  selectedChatId: number | null,
  onInfo: (msg: string) => void,
  onError: (msg: string) => void,
) {
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [callActive, setCallActive] = useState(false);
  const [callMuted, setCallMuted] = useState(false);
  const [callCameraOff, setCallCameraOff] = useState(false);
  const [callElapsed, setCallElapsed] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  const callSocketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callModalOpenRef = useRef(false);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const sendCallSignalRef = useRef<(payload: Record<string, unknown>) => void>(() => {});
  const teardownCallRef = useRef<(notify?: boolean) => void>(() => {});
  const onInfoRef = useRef(onInfo);

  useEffect(() => {
    callModalOpenRef.current = callModalOpen;
  }, [callModalOpen]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    onInfoRef.current = onInfo;
  }, [onInfo]);

  // Call timer
  useEffect(() => {
    if (!callModalOpen || !callActive) return;
    const interval = window.setInterval(() => {
      setCallElapsed((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [callModalOpen, callActive]);

  const sendCallSignal = useCallback((payload: Record<string, unknown>) => {
    if (callSocketRef.current?.readyState === WebSocket.OPEN) {
      callSocketRef.current.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    sendCallSignalRef.current = sendCallSignal;
  }, [sendCallSignal]);

  const teardownCall = useCallback(
    (notify = true) => {
      if (notify && selectedChatId) {
        sendCallSignal({ type: 'call.end', chat_id: selectedChatId });
      }
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
      setCallActive(false);
      setCallElapsed(0);
      setIncomingCall(null);
      setCallModalOpen(false);
    },
    [selectedChatId, sendCallSignal],
  );

  useEffect(() => {
    teardownCallRef.current = teardownCall;
  }, [teardownCall]);

  const createPeerConnection = useCallback(
    (chatId: number) => {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        ],
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendCallSignal({
            type: 'call.ice',
            chat_id: chatId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        event.streams[0]?.getTracks().forEach((track) => {
          remoteStreamRef.current?.addTrack(track);
        });
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStreamRef.current;
        }
        setCallActive(true);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          teardownCall(false);
        }
      };

      peerConnectionRef.current = pc;
      return pc;
    },
    [sendCallSignal, teardownCall],
  );

  const waitForCallSocket = useCallback(async () => {
    if (callSocketRef.current?.readyState === WebSocket.OPEN) return true;
    if (callSocketRef.current?.readyState !== WebSocket.CONNECTING) return false;
    return await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => resolve(false), 4000);
      const handleOpen = () => {
        window.clearTimeout(timeout);
        resolve(true);
      };
      callSocketRef.current?.addEventListener('open', handleOpen, { once: true });
    });
  }, []);

  const startCall = useCallback(
    async (type: 'voice' | 'video', chatId: number, chatType: string) => {
      if (chatType !== 'direct') {
        onInfo('Звонки доступны только в личных чатах.');
        return;
      }
      const wsReady = await waitForCallSocket();
      if (!wsReady) {
        onError('Сигнальный сервер недоступен. Попробуйте позже.');
        return;
      }
      try {
        setCallType(type);
        setCallModalOpen(true);
        setCallActive(false);
        setCallMuted(false);
        setCallCameraOff(false);
        setCallElapsed(0);
        const constraints: MediaStreamConstraints =
          type === 'video' ? { audio: true, video: true } : { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        const pc = createPeerConnection(chatId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendCallSignal({ type: 'call.offer', chat_id: chatId, call_type: type, sdp: offer });
      } catch (err) {
        if (err instanceof Error) onError(err.message);
        teardownCall(false);
      }
    },
    [waitForCallSocket, createPeerConnection, sendCallSignal, teardownCall, onInfo, onError],
  );

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      setCallType(incomingCall.callType);
      setCallModalOpen(true);
      setCallActive(false);
      const constraints: MediaStreamConstraints =
        incomingCall.callType === 'video'
          ? { audio: true, video: true }
          : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      const pc = createPeerConnection(incomingCall.chatId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(incomingCall.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendCallSignal({ type: 'call.answer', chat_id: incomingCall.chatId, sdp: answer });
      setIncomingCall(null);
    } catch (err) {
      if (err instanceof Error) onError(err.message);
      teardownCall(false);
    }
  }, [incomingCall, createPeerConnection, sendCallSignal, teardownCall, onError]);

  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    sendCallSignal({ type: 'call.decline', chat_id: incomingCall.chatId });
    setIncomingCall(null);
  }, [incomingCall, sendCallSignal]);

  const handleToggleMute = useCallback(() => {
    setCallMuted((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      return next;
    });
  }, []);

  const handleToggleCamera = useCallback(() => {
    setCallCameraOff((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = !next;
      });
      return next;
    });
  }, []);

  // WebSocket connection
  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    const wsUrl = buildWsUrl(`/calls/ws?token=${encodeURIComponent(token)}`);
    const socket = new WebSocket(wsUrl);
    callSocketRef.current = socket;

    socket.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: string;
          chat_id?: number;
          from_user_id?: number;
          sdp?: RTCSessionDescriptionInit;
          candidate?: RTCIceCandidateInit;
          call_type?: 'voice' | 'video';
        };
        const chatId = payload.chat_id;
        if (!chatId || typeof chatId !== 'number') return;

        switch (payload.type) {
          case 'call.offer': {
            if (callModalOpenRef.current || incomingCallRef.current || peerConnectionRef.current) {
              sendCallSignalRef.current({ type: 'call.decline', chat_id: chatId });
              return;
            }
            setIncomingCall({
              chatId,
              fromUserId: payload.from_user_id || 0,
              callType: payload.call_type === 'video' ? 'video' : 'voice',
              sdp: payload.sdp || { type: 'offer', sdp: '' },
            });
            break;
          }
          case 'call.answer': {
            if (peerConnectionRef.current && payload.sdp) {
              await peerConnectionRef.current.setRemoteDescription(payload.sdp);
            }
            break;
          }
          case 'call.ice': {
            if (peerConnectionRef.current && payload.candidate) {
              await peerConnectionRef.current.addIceCandidate(payload.candidate);
            }
            break;
          }
          case 'call.decline': {
            onInfoRef.current('Вызов отклонен.');
            teardownCallRef.current(false);
            break;
          }
          case 'call.end': {
            onInfoRef.current('Звонок завершен.');
            teardownCallRef.current(false);
            break;
          }
        }
      } catch {
        // ignore malformed
      }
    };

    socket.onclose = () => {
      callSocketRef.current = null;
    };

    return () => {
      socket.close();
    };
  }, []);

  const formatCallTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return {
    callModalOpen,
    setCallModalOpen,
    callType,
    callActive,
    callMuted,
    callCameraOff,
    callElapsed,
    incomingCall,
    setIncomingCall,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    startCall,
    acceptCall,
    declineCall,
    handleToggleMute,
    handleToggleCamera,
    teardownCall,
    formatCallTime,
  };
}
