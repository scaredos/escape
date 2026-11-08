// Transport-agnostic links. The host's own player uses a LocalLink; friends use PeerJS links (net/peer.ts).
import type { C2H, H2C } from '../game/protocol';

export interface ClientLink { send(m: C2H, reliable?: boolean): void; onMessage: (m: H2C) => void; onClose: (reason: string) => void; close(): void }

/** Loopback link between the host's client and the in-page Sim. Messages are cloned via JSON like the real wire. */
export class LocalLink implements ClientLink {
  onMessage: (m: H2C) => void = () => {};
  onClose: (reason: string) => void = () => {};
  toHost: (m: C2H) => void = () => {};
  send(m: C2H) { const c = JSON.parse(JSON.stringify(m)); this.toHost(c); }
  deliver(m: H2C) { const c = JSON.parse(JSON.stringify(m)); queueMicrotask(() => this.onMessage(c)); }
  close() {}
}

/** 60 Hz tick from a dedicated worker: page timers and rAF are throttled in hidden tabs (spec 05 front-end addendum). */
export function startTicker(fn: () => void): () => void {
  const src = 'let id=setInterval(()=>postMessage(0),16);onmessage=()=>clearInterval(id);';
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = fn;
  return () => { w.postMessage(0); w.terminate(); };
}
