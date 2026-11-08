import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests', timeout: 900_000, workers: 1, reporter: [['list']],
  use: { viewport: { width: 1280, height: 720 }, launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  webServer: { command: 'npx vite --port 5179 --strictPort', url: 'http://localhost:5179', reuseExistingServer: true, timeout: 120_000 },
});
