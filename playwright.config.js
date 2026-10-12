import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  reporter: process.env.CI
    ? [
        ["list"],
        ["github"],
        ["json", { outputFile: "test-results/results.json" }],
      ]
    : "list",
  timeout: 120000,
  workers: 1,
  maxFailures: process.env.CI ? 1 : 0,
  fullyParallel: false,
  use: {
    baseURL: process.env.BENCHMARK_URL || "http://127.0.0.1:4183/dual-track-transcription-benchmark/",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
    permissions: ["microphone"],
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 850 } } },
    {
      name: "android-layout",
      use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: process.env.BENCHMARK_URL ? undefined : {
    command: "npm run build && npm run preview",
    port: 4183,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
