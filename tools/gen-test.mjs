// Runs the world generator in Node (via Vite SSR) and prints the city_built stats.
import { createServer } from 'vite';
import fs from 'node:fs';
const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error', appType: 'custom' });
const { generateWorld } = await server.ssrLoadModule('/src/world/gen/index.ts');
const pack = JSON.parse(fs.readFileSync('public/data/world.pack.json', 'utf8'));
const out = generateWorld(pack);
const props = Object.fromEntries(Object.entries(out.props).map(([k, v]) => [k, v.length / 10]));
const boxes = Object.fromEntries(Object.entries(out.boxes).map(([k, v]) => [k, v.length / 13]));
console.log(JSON.stringify(out.stats));
console.log('boxes', JSON.stringify(boxes));
console.log('props', JSON.stringify(props));
console.log('colliders', out.colliders.length / 7, 'walk', out.walkPoints.length / 2, 'signs', out.signs.length, 'lights', out.lights.length);
await server.close();
