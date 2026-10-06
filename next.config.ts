import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 8mb cubre PDFs grandes + fotos OCR. Bajar a 4mb si nunca se suben PDFs.
      bodySizeLimit: "8mb",
    },
    // Caché del router en el cliente: volver a una página visitada hace <60s es
    // instantáneo (sin round-trip al servidor ni pantalla de carga).
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
  typescript: {
    // El build verifica tipos con tsconfig.json sobre TODOS los archivos de su
    // "include" (tests incluidos), igual que `npx tsc --noEmit -p .`: cualquier
    // error de tsc rompe el build.
    //
    // Ojo con @pascal-app/editor: publica su código fuente .tsx sin compilar
    // como entry (package.json "exports" → ./src/index.tsx). Hoy ningún archivo
    // del proyecto lo importa, así que no entra al programa de TypeScript. Si
    // alguien lo importa, tsc revisará esos .tsx (skipLibCheck solo cubre .d.ts)
    // y aparecen ~88 errores de tipos propios del paquete que romperán el build.
    ignoreBuildErrors: false,
  },
  transpilePackages: ["@pascal-app/core", "@pascal-app/viewer", "@pascal-app/editor"],
};

export default nextConfig;
