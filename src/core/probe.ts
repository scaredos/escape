// PROBE log (spec 05 H18): one machine-checkable line per event, also kept in window.__probes for tests.
declare global { interface Window { __probes?: any[] } }
const g: any = globalThis as any;
export function probe(event: string, fields: Record<string, unknown> = {}) {
  const o = { event, ...fields };
  if (!g.__probes) g.__probes = [];
  g.__probes.push(o);
  if (g.__probes.length > 5000) g.__probes.splice(0, 1000);
  console.log('PROBE ' + JSON.stringify(o));
  for (const l of listeners) l(o);
}
const listeners: ((o: any) => void)[] = [];
export function onProbe(fn: (o: any) => void) { listeners.push(fn); }
