import { useEffect, useRef } from 'react';
import { getGuestToken } from './api';

type Listener = (evt: { channel: string; type: string; data: any }) => void;

/**
 * One shared WebSocket per tab. Events are hints: on (re)connect every subscriber's onReconnect runs so
 * screens refetch the REST snapshot. If the socket is down, screens still poll (react-query refetchInterval).
 */
class Realtime {
  private ws: WebSocket | null = null;
  private subs = new Map<number, { channels: string[]; fn: Listener; onReconnect?: () => void }>();
  private nextId = 1;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe(channels: string[], fn: Listener, onReconnect?: () => void) {
    const id = this.nextId++;
    this.subs.set(id, { channels, fn, onReconnect });
    if (!this.ws) this.connect();
    else if (this.ws.readyState === WebSocket.OPEN) this.sendSubs([channels]);
    return () => {
      this.subs.delete(id);
    };
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      const wasRetry = this.retry > 0;
      this.retry = 0;
      this.sendSubs([...this.subs.values()].map((s) => s.channels));
      if (wasRetry) for (const s of this.subs.values()) s.onReconnect?.();
    };
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(m.data);
        if (msg.op !== 'evt') return;
        for (const s of this.subs.values()) if (s.channels.includes(msg.channel)) s.fn(msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.subs.size === 0) return;
      this.retry++;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retry, 5));
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  private sendSubs(list: string[][]) {
    const channels = [...new Set(list.flat())];
    if (!channels.length || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ op: 'sub', channels, token: getGuestToken() ?? undefined }));
  }
}

export const realtime = new Realtime();

/** Subscribe to channels for the component's lifetime. */
export function useChannels(channels: Array<string | null | undefined>, onEvent: Listener, onReconnect?: () => void) {
  const fnRef = useRef(onEvent);
  const reRef = useRef(onReconnect);
  fnRef.current = onEvent;
  reRef.current = onReconnect;
  const key = channels.filter(Boolean).join('|');
  useEffect(() => {
    if (!key) return;
    return realtime.subscribe(key.split('|'), (e) => fnRef.current(e), () => reRef.current?.());
  }, [key]);
}
