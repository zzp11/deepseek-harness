import { defineConfig } from 'tsdown'

/**
 * The Node-side library. `projection` is a separate entry because the browser
 * half imports it: it must not pull the plugin root's cordis and registry
 * dependencies into a browser bundle.
 */
export default defineConfig({
  name: '@deepseek-ai/dsh-workbench',
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/projection.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
