import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.BENCHMARK_BASE || "/dual-track-transcription-benchmark/",
  worker: { format: "es" },
  build: { target: "es2022" },
});
