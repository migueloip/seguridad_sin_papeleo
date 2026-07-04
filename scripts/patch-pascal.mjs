#!/usr/bin/env node
// Parches sobre paquetes @pascal-app/* publicados en npm. Cada parche es
// idempotente (detecta si ya está aplicado y no hace nada) y valida que el
// bloque original siga presente (loud-fail si Pascal cambió el código).
// Se ejecuta como postinstall en package.json.
//
// Parche 1 — WebGPU init:
//   @pascal-app/viewer construye un WebGPURenderer sin await renderer.init(),
//   lo que provoca el warning "Renderer: .render() called before the backend
//   is initialized" en consola durante el primer frame. Convertimos el
//   callback `gl` de R3F a async y esperamos la inicialización.
//
// Parche 2 — CDN local:
//   @pascal-app/viewer/lib/asset-url.js usa
//     process.env.NEXT_PUBLIC_ASSETS_CDN_URL || 'https://editor.pascal.app'
//   como base para resolver thumbnails y modelos GLB de items. En Easy Secure
//   los assets viven en public/items/ del propio host, así que cambiamos el
//   fallback a string vacío (`??` en vez de `||`, y default ''). Resultado:
//   resolveCdnUrl("/items/x") devuelve "/items/x", relativo al origen actual.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT = path.resolve(__dirname, "..")

/** @type {Array<{name: string, file: string, marker: string, original: string, patched: string}>} */
const PATCHES = [
  {
    name: "webgpu-init",
    file: "node_modules/@pascal-app/viewer/dist/components/viewer/index.js",
    marker: "ssp-patch: avoid pre-init render warning",
    original: `gl: (props) => {
            const renderer = new THREE.WebGPURenderer(props);
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 0.9;
            // renderer.init() // Only use when using <DebugRenderer />
            return renderer;
        }`,
    patched: `gl: async (props) => {
            const renderer = new THREE.WebGPURenderer(props);
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 0.9;
            await renderer.init(); /* ssp-patch: avoid pre-init render warning */
            return renderer;
        }`,
  },
  {
    name: "cdn-local",
    file: "node_modules/@pascal-app/viewer/dist/lib/asset-url.js",
    marker: "ssp-patch: use local origin for assets",
    original: `export const ASSETS_CDN_URL = process.env.NEXT_PUBLIC_ASSETS_CDN_URL || 'https://editor.pascal.app';`,
    patched: `export const ASSETS_CDN_URL = process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? ''; /* ssp-patch: use local origin for assets */`,
  },
]

function applyPatch({ name, file, marker, original, patched }) {
  const target = path.resolve(ROOT, file)
  if (!fs.existsSync(target)) {
    console.log(`[patch-pascal:${name}] target not found, skip: ${target}`)
    return
  }
  const src = fs.readFileSync(target, "utf8")
  if (src.includes(marker)) {
    console.log(`[patch-pascal:${name}] already patched`)
    return
  }
  if (!src.includes(original)) {
    console.warn(
      `[patch-pascal:${name}] expected source block not found — paquete cambió. Revisar scripts/patch-pascal.mjs.`,
    )
    return
  }
  fs.writeFileSync(target, src.replace(original, patched), "utf8")
  console.log(`[patch-pascal:${name}] applied`)
}

for (const patch of PATCHES) {
  applyPatch(patch)
}
