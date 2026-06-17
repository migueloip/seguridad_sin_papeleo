const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

// El componente architect3d es un proyecto legacy (rollup 1.x, babel 6,
// eslint 4) cuyo bundle ya viene compilado y versionado en build/js/.
// Reconstruirlo en cada `npm run dev` es innecesario y, además, instalar su
// toolchain antiguo en Node moderno es lento y propenso a fallar. Por eso:
//   - Si el bundle ya existe -> se omite rollup (caso normal).
//   - Si falta -> se instalan deps (si hace falta) y se construye.
// Forzar una reconstrucción: borrar external_component/architect3d-master/build
// (o definir REBUILD_ARCHITECT3D=1).

const compDir = path.join(__dirname, "..", "external_component", "architect3d-master")
const artifact = path.join(compDir, "build", "js", "bp3djs.js")
const forceRebuild = process.env.REBUILD_ARCHITECT3D === "1"

if (!forceRebuild && fs.existsSync(artifact)) {
  console.log("[architect3d] Bundle pre-compilado encontrado, se omite el build de rollup.")
  process.exit(0)
}

if (!fs.existsSync(path.join(compDir, "node_modules"))) {
  console.log("[architect3d] Instalando dependencias del componente externo...")
  execSync("npm install", { cwd: compDir, stdio: "inherit" })
}

console.log("[architect3d] Construyendo bundle con rollup...")
execSync("npm run build", { cwd: compDir, stdio: "inherit" })
