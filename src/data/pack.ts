// Load the packed world data and generate the world in a worker.
import type { GenOutput, Pack } from '../world/types';

export async function loadPack(onProgress: (f: number) => void): Promise<Pack> {
  const res = await fetch('./data/world.pack.json');
  if (!res.ok) throw new Error('world.pack.json ' + res.status);
  const total = +(res.headers.get('content-length') || 0) || 1_000_000;
  const reader = res.body!.getReader(); const chunks: Uint8Array[] = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(Math.min(1, got / total)); }
  const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  return JSON.parse(new TextDecoder().decode(buf));
}

export function generateInWorker(pack: Pack, onProgress: (f: number, label: string) => void): Promise<GenOutput> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../world/gen.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { if (e.data.out) { resolve(e.data.out); w.terminate(); } else onProgress(e.data.progress, e.data.label); };
    w.onerror = (e) => { reject(new Error(e.message)); w.terminate(); };
    w.postMessage({ pack });
  });
}
