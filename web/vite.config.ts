import { defineConfig } from "vite";

// O site é servido na raiz do Cloudflare Pages (VITE_SITE_URL em .env). Para gerar a versão do GitHub
// Pages, que fica numa subpasta: SITE_BASE=/brasil-urna-por-urna/ npm run build
export default defineConfig({
  base: process.env.SITE_BASE ?? "/",
  build: { chunkSizeWarningLimit: 1200 }, // o MapLibre sozinho tem ~1 MB (~290 KB comprimido)
});
