// World generation runs off the main thread (spec 01 §5, PROMPT §3).
import { generateWorld } from './gen/index';
import type { Pack } from './types';

self.onmessage = (e: MessageEvent<{ pack: Pack }>) => {
  const out = generateWorld(e.data.pack, (f, label) => (self as any).postMessage({ progress: f, label }));
  const transfer: ArrayBuffer[] = [];
  for (const v of Object.values(out)) if (v instanceof Float32Array) transfer.push(v.buffer as ArrayBuffer);
  for (const rec of [out.boxes, out.props]) for (const v of Object.values(rec)) transfer.push(v.buffer as ArrayBuffer);
  (self as any).postMessage({ out }, transfer);
};
