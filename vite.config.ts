import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const base = env.VITE_BASE_PATH || '/';

  return {
    base,
    build: {
      copyPublicDir: false,
      manifest: 'asset-manifest.json',
      rollupOptions: {
        input: {
          app: 'index.html',
          'service-worker': 'src/sw.ts',
        },
        output: {
          entryFileNames: (chunkInfo) =>
            chunkInfo.name === 'service-worker'
              ? 'sw.js'
              : 'assets/[name]-[hash].js',
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        // Public assets are copied manually so large linked DICOM samples
        // can be excluded from production builds.
        name: 'copy-public-without-linked-dicoms',
        apply: 'build',
        async closeBundle() {
          const publicDir = resolve('public');
          const outDir = resolve('dist');

          await mkdir(outDir, { recursive: true });
          for (const entry of await readdir(publicDir)) {
            if (entry === 'sample-dicom') {
              await rm(join(outDir, entry), { force: true, recursive: true });
              continue;
            }

            await cp(join(publicDir, entry), join(outDir, entry), {
              dereference: false,
              force: true,
              recursive: true,
            });
          }
        },
      },
    ],
  };
});
