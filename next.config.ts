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
    // Necesario porque @pascal-app/editor distribuye .tsx sin compilar como
    // entry de su package.json. Esos archivos tienen errores de tipos propios
    // del paquete (no nuestros) que skipLibCheck no cubre porque solo aplica a
    // .d.ts. Nuestro código sí compila limpio — verificable con `npx tsc --noEmit`
    // filtrando node_modules.
    ignoreBuildErrors: true,
  },
  transpilePackages: ["@pascal-app/core", "@pascal-app/viewer", "@pascal-app/editor"],
};

export default nextConfig;
