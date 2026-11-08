// PeerJS (WebRTC) transport (spec 05 H16): host peer id 'escape-israel-<CODE>', two channels per client: rel + snap.
import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { C2H, H2C } from '../game/protocol';
import type { ClientLink } from './link';

export const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newRoomCode = () => Array.from({ length: 5 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
export const peerIdFor = (code: string) => 'escape-israel-' + code.toUpperCase();

export function peerOptions(params: URLSearchParams): PeerOptions {
  const o: PeerOptions = { debug: 0 };
  if (params.get('peerhost')) { o.host = params.get('peerhost')!; o.port = +(params.get('peerport') || 9000); o.path = params.get('peerpath') || '/'; o.secure = location.protocol === 'https:' && o.host !== 'localhost'; o.key = 'peerjs'; }
  const ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turn = params.get('turn'); if (turn) ice.push({ urls: turn });
  o.config = { iceServers: ice };
  return o;
}

export interface HostSide { onConnect(id: string, send: (m: H2C, reliable: boolean) => void, close: () => void): (m: C2H) => void; onDisconnect(id: string): void }

/** Open the host peer. Resolves with the room code actually used (retries on 'unavailable-id'). */
export function openHost(code: string, params: URLSearchParams, side: HostSide): Promise<{ code: string; peer: Peer }> {
  return new Promise((resolve, reject) => {
    const tryOpen = (c: string, left: number) => {
      const peer = new Peer(peerIdFor(c), peerOptions(params));
      const clients = new Map<string, { rel?: DataConnection; snap?: DataConnection; handler?: (m: C2H) => void; last: number }>();
      peer.on('open', () => resolve({ code: c, peer }));
      peer.on('error', (e: any) => {
        if (e.type === 'unavailable-id' && left > 0) { peer.destroy(); tryOpen(params.get('room') ? c : newRoomCode(), left - 1); }
        else if (!peer.open) reject(e);
      });
      peer.on('connection', (conn) => {
        const cid = conn.peer;
        let c = clients.get(cid); if (!c) clients.set(cid, (c = { last: performance.now() }));
        if (conn.label === 'snap') c.snap = conn; else c.rel = conn;
        const entry = c;
        conn.on('open', () => {
          if (entry.rel?.open && !entry.handler) {
            const send = (m: H2C, reliable: boolean) => { const ch = !reliable && entry.snap?.open ? entry.snap : entry.rel; try { ch?.send(m); } catch { /* closed */ } };
            entry.handler = side.onConnect(cid, send, () => { entry.rel?.close(); entry.snap?.close(); clients.delete(cid); });
          }
        });
        conn.on('data', (d) => { entry.last = performance.now(); entry.handler?.(d as C2H); });
        conn.on('close', () => { if (clients.has(cid)) { clients.delete(cid); side.onDisconnect(cid); } });
      });
      setInterval(() => { // 30 s of silence = disconnect (spec says 10 s, choose: slow first frames compile shaders for >10 s)
        for (const [cid, c] of clients) if (performance.now() - c.last > 30000 && c.handler) { clients.delete(cid); c.rel?.close(); c.snap?.close(); side.onDisconnect(cid); }
      }, 1000);
    };
    tryOpen(code, 5);
  });
}

export class PeerClientLink implements ClientLink {
  onMessage: (m: H2C) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private peer: Peer; private rel!: DataConnection; private snap!: DataConnection; private closed = false;
  ready: Promise<void>;
  constructor(code: string, params: URLSearchParams) {
    this.peer = new Peer(peerOptions(params));
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Couldn't connect to the host: a firewall or strict NAT blocks peer-to-peer. Try another network, or the host can add a TURN server (?turn=)")), 15000);
      this.peer.on('error', (e: any) => {
        clearTimeout(timer);
        const msg = e.type === 'peer-unavailable' ? 'Room not found' : ['network', 'server-error', 'socket-error'].includes(e.type) ? "Can't reach the matchmaking server" : String(e.message || e.type);
        if (!this.rel?.open) reject(new Error(msg)); else this.fail(msg);
      });
      this.peer.on('open', () => {
        const host = peerIdFor(code);
        this.rel = this.peer.connect(host, { reliable: true, label: 'rel', serialization: 'json' });
        this.snap = this.peer.connect(host, { reliable: false, label: 'snap', serialization: 'json' });
        let n = 0;
        const opened = () => { if (++n === 2) { clearTimeout(timer); setInterval(() => this.send({ t: 'ping', t0: performance.now() / 1000 }, true), 1000); resolve(); } };
        for (const ch of [this.rel, this.snap]) {
          ch.on('open', opened);
          ch.on('data', (d) => this.onMessage(d as H2C));
          ch.on('close', () => this.fail('Host left the game'));
        }
      });
    });
  }
  private fail(reason: string) { if (this.closed) return; this.closed = true; this.onClose(reason); }
  send(m: C2H, reliable = true) { const ch = reliable ? this.rel : this.snap; try { if (ch?.open) ch.send(m); } catch { /* ignore */ } }
  close() { this.closed = true; try { this.send({ t: 'bye' }); } catch { /* ignore */ } setTimeout(() => this.peer.destroy(), 200); }
}
