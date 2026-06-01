import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const base = env.VITE_BASE_PATH || '/';

  // Cross-origin isolation enables SharedArrayBuffer, which onnxruntime-web
  // needs for multi-threaded wasm. The DentalSegmentator nnU-Net runs on the
  // wasm EP (its 3D ConvTranspose is unsupported by the WebGPU EP), so threads
  // are what make full-volume inference ~1 min instead of several. `credentialless`
  // keeps cross-origin no-cors subresources working. Production hosting must send
  // these same headers for threads to be available.
  const coiHeaders = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  };

  return {
    base,
    server: { headers: coiHeaders },
    preview: { headers: coiHeaders },
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
        // Dev only: serve the onnxruntime-web WASM runtime at `${base}ort/`
        // straight from node_modules. In `vite dev` these files can't live in
        // /public — Vite refuses to let ORT dynamically import the .mjs glue
        // from a public path ("should not be imported from source code"). A
        // pre-middleware (registered in the hook body, before Vite's internal
        // handlers) sidesteps that by streaming the raw file. The build path
        // uses public/ort via `npm run stage:ort` instead.
        name: 'serve-ort-wasm-dev',
        apply: 'serve',
        configureServer(server) {
          const ortDir = resolve('node_modules/onnxruntime-web/dist');
          server.middlewares.use((req, res, next) => {
            const match = (req.url ?? '').match(/\/ort\/([^?]+)/);
            if (!match) return next();
            const file = basename(match[1]);
            const filePath = join(ortDir, file);
            if (!existsSync(filePath)) return next();
            res.setHeader(
              'Content-Type',
              extname(file) === '.wasm'
                ? 'application/wasm'
                : 'text/javascript',
            );
            createReadStream(filePath).on('error', next).pipe(res);
          });
        },
      },
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
