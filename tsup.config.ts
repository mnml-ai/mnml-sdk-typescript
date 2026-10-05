import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/webhooks.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
  sourcemap: true,
});
