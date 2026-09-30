import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts', migrate: 'src/cli/migrate.ts', seed: 'src/cli/seed.ts', 'simulate-device': 'src/cli/simulate-device.ts' },
  format: 'esm',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // The shared package ships TypeScript source; bundle it into the API output.
  noExternal: ['@dobi/shared'],
});
