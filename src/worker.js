import { pipeline, env } from "@huggingface/transformers";
let transcriber, model;
const nativeFetch = globalThis.fetch.bind(globalThis);
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      model = data.model;
      const base = new URL(data.base, self.location.origin).href;
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = base + "models/";
      env.useBrowserCache = false;
      env.useFSCache = false;
      env.useCustomCache = false;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      env.backends.onnx.wasm.wasmPaths = {
        mjs: base + "runtime/ort-wasm-simd-threaded.jsep.mjs",
        wasm: base + "runtime/ort-wasm-simd-threaded.jsep.wasm",
      };
      const files = [
        ...model.files.map((f) => ({
          ...f,
          path: `models/${model.id}/${f.path}`,
        })),
        ...data.runtime,
      ];
      const permitted = new Map(
        files.map((f) => [new URL(f.path, base).href, f]),
      );
      globalThis.fetch = (input, options = {}) => {
        const url = new URL(typeof input === "string" ? input : input.url, base)
            .href,
          file = permitted.get(url);
        if (!file)
          return Promise.reject(new Error("Unlisted model resource refused."));
        if (options.method && options.method !== "GET")
          return Promise.reject(new Error("Only static downloads allowed."));
        const bytes = file.sha256.match(/../g).map((n) => parseInt(n, 16));
        return nativeFetch(url, {
          ...options,
          method: "GET",
          body: undefined,
          credentials: "omit",
          integrity: "sha256-" + btoa(String.fromCharCode(...bytes)),
        });
      };
      const start = performance.now();
      transcriber = await pipeline("automatic-speech-recognition", model.id, {
        dtype: "q8",
        device: "wasm",
        local_files_only: true,
        progress_callback: (p) => {
          if (p.status === "progress")
            self.postMessage({ type: "progress", progress: p.progress });
        },
      });
      self.postMessage({
        type: "ready",
        milliseconds: performance.now() - start,
      });
    } else if (data.type === "run") {
      if (!transcriber) throw new Error("Load a model first.");
      const samples = new Float32Array(data.samples),
        start = performance.now();
      let text = "";
      if (model.id === "whisper") {
        const result = await transcriber(samples, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: false,
        });
        text = result.text;
      } else {
        const length = 15 * 16000;
        for (let i = 0; i < samples.length; i += length) {
          const result = await transcriber(samples.subarray(i, i + length));
          text += (text ? " " : "") + result.text;
          self.postMessage({
            type: "progress",
            progress:
              (100 * Math.min(i + length, samples.length)) / samples.length,
          });
        }
      }
      self.postMessage({
        type: "result",
        text: text.trim(),
        milliseconds: performance.now() - start,
      });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error.message || "Model processing failed").slice(0, 300),
    });
  }
};
