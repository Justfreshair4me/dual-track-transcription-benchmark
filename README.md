# Isolated local audio transcription benchmark

This is a **standalone experimental site**, not production application code. Do not merge the experiment into the tracker or deploy its `dist` over the tracker. No production files, schema, entries, backups, or service worker are changed. This repository contains the standalone benchmark extracted from draft PR #6 in `Justfreshair4me/dual-track-life-tracker` (source commit `cacb783022ff70a38e1d7b0af8d3ea1b5c92aec5`). That PR remains unmerged. The benchmark is hosted separately at [its GitHub Pages address](https://justfreshair4me.github.io/dual-track-transcription-benchmark/).

## What it tests

Record once with MediaRecorder; after Stop releases the microphone, decode the completed original Blob to mono 16 kHz PCM, and run local browser WASM inference in a dedicated worker. No Web Speech API and no external transcription service. If a model is loaded, stopping automatically transcribes; otherwise download the clip, load a model with explicit consent, then press Transcribe. Switch models and reuse the unchanged clip. Original bytes are available for playback/download.

- Whisper Tiny English q8: **45,091,984 bytes** model package.
- Moonshine Tiny q8: **32,080,539 bytes** model package.
- Shared browser runtime: **21,640,503 bytes**, plus about 0.9 MB worker JavaScript and small page code. Model metadata packages include a few optional unused files, so these are upper bounds. HTTP compression/caching can reduce transferred bytes; this is not a RAM estimate.
- Exact Hugging Face repository revisions, file lengths and SHA-256 are in `models.lock.json`. Runtime and all transitive package versions are pinned by `package-lock.json`. Transformers.js **3.8.1**, ONNX Runtime Web **1.22.0-dev.20250409-89f8206ba4** (the exact version used by Transformers.js).
- Build-time model source: `https://huggingface.co/onnx-community/whisper-tiny.en` and `https://huggingface.co/onnx-community/moonshine-tiny-ONNX`, immutable revisions in the lock. In the phone, all files are downloaded from the benchmark's own HTTPS site. Builds check SHA-256; worker fetches use subresource integrity. No user audio is involved in downloading/building models.
- CPU / one thread; no GPU, SharedArrayBuffer, special cross-origin isolation headers, browser speech service, account, cloud processing or recurring costs.
- Whisper processes 30-second chunks with overlap; Moonshine uses consecutive 15-second chunks to bound attention memory. Both consume the **same PCM**, but chunk boundaries can affect accuracy (especially Moonshine's no-overlap word boundaries). This comparison is not a claim of equivalent decoding algorithms.

## Storage and privacy

GitHub Pages project sites for one username share an origin, including IndexedDB and quota. Even in a separate repository, a huge persistent model cache could compete with tracker storage. This benchmark does **not** call IndexedDB, localStorage, CacheStorage, or service worker registration. Models/clips/reports exist only in RAM; normal browser-managed HTTP caching may occur. Nothing clears any browser storage. No tracker database is read. Do not host it underneath the tracker's service-worker scope.

A loaded model can transcribe offline in the same open tab. Offline reopening/model switching is not guaranteed. Closing/reloading the tab loses unsaved clips and reports. **Download the original before heavy tests and verify the file is in Downloads.** Android may terminate the entire tab for low memory; JavaScript cannot catch that or promise recovery. Worker failures/cancel/timeouts retain the clip if the tab survives. Reload and import the downloaded original to recover.

Reported JS heap is Chromium's optional approximate metric, **not total browser/WASM RAM**. Device memory and core count are optional coarse hints. Model load time includes worker startup, static downloads, compilation and initialization; inference time excludes decoding and downloading. Repeat downloads may be HTTP-cache hits; compare cold/warm load timings accordingly. No battery sampling is included; observe battery/heat manually. A hidden tab is flagged in results because throttling affects measurements. Avoid confidential work, health, or personal content: use fictional scripts.

## Open the benchmark and check deployment

Open [Local Audio Benchmark](https://justfreshair4me.github.io/dual-track-transcription-benchmark/) in Chrome or Brave. You do not need to install development software, download source files, or create an application account.

GitHub Pages uses GitHub Actions in this repository. Each push to `main` verifies the pinned model files, runs the UI and real-model tests, builds the standalone site, and deploys it. After deployment, the workflow checks the actual HTTPS site at desktop and mobile sizes, including both local models on fictional 15/30/60-second audio. Check the [Actions page](https://github.com/Justfreshair4me/dual-track-transcription-benchmark/actions) for build, deployment, and live verification status. No workflow in the Life Tracker repository is changed.

Model files are fetched automatically during the build; no manual file upload is required. The workflow refuses to deploy unless the repository name is exactly `dual-track-transcription-benchmark`. Public GitHub Pages and standard public Actions runners require no subscription or credit card.

## Android test steps

1. Open the standalone site in Chrome on Android on Wi-Fi, and keep the screen awake. Start with fictional content in a quiet room.
2. Choose **15 seconds**. Tap **Record**, allow microphone access, speak once, and let it auto-stop (or tap Stop). Play back the original to verify it is clear.
3. Tap **Download original audio** and verify it is in Downloads. Choose **Whisper Tiny English → Load selected model**, read the size/privacy confirmation, and accept. Wait for “ready”. Tap **Transcribe this clip locally**. Check the generated words and timings.
4. Select **Moonshine Tiny → Load selected model** and confirm. The previous worker is unloaded to reduce memory. Tap **Transcribe this clip locally** again. Both results should display the identical clip ID. Do **not** record again.
5. Download the local JSON results report. It includes transcripts and local metrics: inspect before sharing; the app never sends it anywhere itself.
6. Repeat steps 2–5 with **30 seconds**, then **60 seconds**. Use the same original clip for each pair of models. Avoid pauses/silence as tiny models can invent words. Once a model is loaded, new recording Stop attempts transcription automatically.
7. Test Cancel during loading/inference, then retry with the retained clip. With a model ready, turn off Wi-Fi/mobile data and transcribe the current clip again. Reconnect before switching models.
8. Repeat in Brave by importing the exact downloaded original clip. Browser file Downloads are used for transfer, not tracker backup/import. Note browser version, device model, Android version, unexpected heat, failed loads/tab reloads, accuracy errors, and whether you were offline.

Phone compatibility, microphone routing, real speech accuracy, battery and memory stability are **not established by desktop Playwright emulation**. Physical Chrome/Brave testing remains the purpose of this experiment. Do not integrate it into the production tracker yet.

## Developer checks (Codex/Actions only; you do not need to install these)

```
npm ci --ignore-scripts
npm run models
node scripts/prepare.mjs
npx playwright install --with-deps chromium
sudo apt-get install -y espeak
python3 scripts/fixtures.py
REAL_MODELS=1 npm test
npm run build
```

Cloud sandbox without Hugging Face access: `node scripts/prepare.mjs`, then `CHROMIUM_PATH=/usr/bin/chromium npm test`. UI tests substitute a synthetic worker by intercepting its URL; there is no test provider or test switch in the production bundle. Real-model tests run only with `REAL_MODELS=1`; they use downloaded verified weights and generated fictional synthetic speech. The two sets are reported separately.

`npm run dev` starts on port 4183; production tests build and serve the GitHub Pages subdirectory, with CSS/JS and CSP checked in a real desktop browser. No source files in the Life Tracker need changing.
