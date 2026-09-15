import { readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const root = import.meta.dirname;
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
// Keep the existing dist module paths available as well as the package entries.
const entries = Object.fromEntries(
  readdirSync(resolve(root, 'src'), { recursive: true })
    .filter((file): file is string => typeof file === 'string' && file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map((file) => [file.slice(0, -3).replaceAll('\\', '/'), resolve(root, 'src', file)]),
);

export default defineConfig({
  plugins: [
    dts({ tsconfigPath: './tsconfig.json', entryRoot: 'src', include: ['src/**/*.ts'] }),
  ],
  build: {
    target: 'node22',
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
    lib: {
      entry: entries,
      formats: ['es', 'cjs'],
      fileName: (format, name) => `${name}.${format === 'es' ? 'mjs' : 'js'}`,
    },
    rolldownOptions: {
      external: (id) => isBuiltin(id) || dependencies.some((name) => id === name || id.startsWith(`${name}/`)),
      output: { exports: 'named' },
    },
  },
});
