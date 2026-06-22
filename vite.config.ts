import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/index.ts",
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
      formats: ["es", "cjs"],
    },
    minify: false,
    rolldownOptions: {
      external: ["node:buffer", "node:util", "node:zlib"],
      output: {
        exports: "named",
      },
    },
    target: "es2022",
  },
});
