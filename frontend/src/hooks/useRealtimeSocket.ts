import { useEffect, useRef, useCallback } from 'react';
import { buildApiUrl, getAuthToken } from '../core/api';
import type { WebhookEvent } from '../core/types';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const PING_INTERVAL_MS = 25000;

const buildWsUrl = (path: string): string => {
  const httpUrl = buildApiUrl(path);
  return httpUrl.replace(/^http/, 'ws');
};

export function useRealtimeSocket(
  onEvent: (event: WebhookEvent) => Promise<void>,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    const token = getAuthToken();
    if (!token) return;

    const wsUrl = buildWsUrl(`/ws/events?token=${encodeURIComponent(token)}`);
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      // Start keepalive pings
      pingTimerRef.current = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return;
        // Convert WS event format to WebhookEvent format
        const webhookEvent: WebhookEvent = {
          event: data.event,
          data: data.data || {},
          timestamp: data.timestamp || new Date().toISOString(),
        };
        await onEventRef.current(webhookEvent);
      } catch {
        // ignore malformed
      }
    };

    socket.onclose = () => {
      socketRef.current = null;
      if (pingTimerRef.current !== null) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (unmountedRef.current) return;
      // Reconnect with exponential backoff
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
      reconnectAttemptRef.current = attempt + 1;
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    };

    socket.onerror = () => {
      // Will trigger onclose
    };
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      clearTimers();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect, clearTimers]);

  return socketRef;
}
