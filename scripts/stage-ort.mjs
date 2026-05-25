#!/usr/bin/env node
/**
 * Stage the onnxruntime-web WASM runtime into public/ort so the production
 * build (and `vite preview`) can serve it at `${BASE}ort/`, matching the
 * worker's `ort.env.wasm.wasmPaths`. Run automatically via the `prebuild`
 * npm hook; also runnable directly with `npm run stage:ort`.
 *
 * onnxruntime-web 1.26 defaults to the JSEP build, so the worker requests
 * `ort-wasm-simd-threaded.jsep.{mjs,wasm}`. These large binaries are not
 * checked in (and the local public/ tree is prone to cloud-sync dehydration),
 * so we copy them straight from node_modules, where `npm install` always
 * restores them. Idempotent: files are only rewritten when missing or a
 * different size.
 *
 * Note: `vite dev` cannot serve these from /public (it rejects importing
 * public files as modules); the dev server instead serves /ort via a
 * middleware in vite.config.ts. This script is for the build path.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const destDir = join(root, 'public', 'ort');

const FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

async function main() {
  await mkdir(destDir, { recursive: true });
  let copied = 0;
  for (const file of FILES) {
    const src = join(srcDir, file);
    const srcSize = await sizeOf(src);
    if (srcSize < 0) {
      console.error(
        `[stage-ort] missing ${file} in onnxruntime-web/dist — run "npm install" first.`,
      );
      process.exitCode = 1;
      return;
    }
    const dest = join(destDir, file);
    if ((await sizeOf(dest)) === srcSize) continue; // already up to date
    await copyFile(src, dest);
    copied += 1;
    console.log(`[stage-ort] staged ${file} (${srcSize} bytes)`);
  }
  console.log(
    copied === 0
      ? '[stage-ort] public/ort already up to date.'
      : `[stage-ort] staged ${copied} file(s) into public/ort.`,
  );
}

await main();
