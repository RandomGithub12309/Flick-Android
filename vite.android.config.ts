import { resolve } from "node:path";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = import.meta.dirname;

export default defineConfig({
  root: resolve(rootDir, "native"),
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: resolve(rootDir, "dist/android"),
    emptyOutDir: true,
  },
});
