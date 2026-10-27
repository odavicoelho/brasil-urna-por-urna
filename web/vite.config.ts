import { defineConfig } from "vite";

// O site é servido em https://odavicoelho.github.io/brasil-urna-por-urna/
export default defineConfig({
  base: "/brasil-urna-por-urna/",
  build: { chunkSizeWarningLimit: 1200 }, // o MapLibre sozinho tem ~1 MB (~290 KB comprimido)
});
