import "./style.css";
const $ = (id) => document.getElementById(id),
  base = import.meta.env.BASE_URL;
let manifest,
  worker,
  loaded,
  busy = false,
  recorder,
  stream,
  timer,
  tick,
  started,
  clip,
  pcm,
  clipURL,
  loadMs = 0,
  results = [],
  hidden = false,
  abandon = false,
  preparing = false,
  loadStarted = 0,
  runSerial = 0,
  lastCoverage = null,
  operation = "idle";
const status = (text) => {
    $("status").textContent = text;
  },
  mb = (n) => (n / 1000000).toFixed(2) + " MB",
  heap = () => performance.memory?.usedJSHeapSize ?? null;
function controls() {
  const recording = recorder?.state === "recording",
    locked = busy || preparing;
  $("load").disabled = !manifest || locked || recording;
  $("model").disabled = locked || recording;
  $("record").disabled = locked || recording;
  $("stop").disabled = !recording;
  $("discard").disabled = !recording;
  $("file").disabled = locked || recording;
  $("run").disabled =
    !clip || !loaded || loaded.id !== $("model").value || locked || recording;
  $("cancel").disabled = !worker;
  $("report").disabled = !results.length;
  $("save-audio").disabled = !clip;
}
function sizes() {
  if (!manifest) return;
  const model = manifest.models.find((m) => m.id === $("model").value);
  $("download-size").textContent =
    `Model package: ${mb(model.bytes)} (${model.bytes.toLocaleString()} bytes). Shared runtime: ${mb(manifest.runtime.reduce((s, f) => s + f.bytes, 0))}. Small page/worker JavaScript is additional. HTTP caching may reduce repeat downloads.`;
  $("versions").textContent =
    `Transformers.js ${manifest.transformers}\nONNX Runtime Web ${manifest.onnx}\nModel: ${model.repo}\nPinned revision: ${model.revision}\nQuantization: q8. CPU threads: 1.\nModel package is an upper bound: unused tokenizer metadata may not be requested.`;
}
let watchdog,
  runStart,
  heapStart,
  decodeMs = 0;
function unload(message) {
  if (message && operation === "transcribing") {
    addResult(
      {
        text: lastCoverage?.partialText || "",
        coverage: lastCoverage,
        error: message,
      },
      "incomplete",
    );
    message += ` Elapsed ${((performance.now() - runStart) / 1000).toFixed(2)} s. Completed audio ${((lastCoverage?.processedSamples || 0) / 16000).toFixed(1)} s; transcription is incomplete.`;
  }
  runSerial++;
  operation = "idle";
  worker?.terminate();
  worker = null;
  loaded = null;
  busy = false;
  clearTimeout(watchdog);
  $("progress").hidden = true;
  $("model-status").textContent = "Model not loaded.";
  if (message) status(message + " Original clip is retained.");
  controls();
}
function arm(milliseconds = 300000) {
  clearTimeout(watchdog);
  watchdog = setTimeout(
    () =>
      unload(
        "Processing timed out; no complete result was produced. Retry with a shorter clip.",
      ),
    milliseconds,
  );
}
function load() {
  const selected = manifest.models.find((m) => m.id === $("model").value),
    total = selected.bytes + manifest.runtime.reduce((s, f) => s + f.bytes, 0);
  if (
    !confirm(
      `Download up to ${mb(total)} of model/runtime files, plus worker JavaScript, from this site? Inference stays on this device. Memory use is higher than download size. This replaces any loaded model, not your recording. Use Wi-Fi if mobile data is limited.`,
    )
  )
    return;
  unload();
  busy = true;
  operation = "loading";
  $("model-status").textContent = "Downloading and loading model…";
  status("Loading model locally. Keep this tab visible.");
  $("progress").hidden = false;
  $("progress").removeAttribute("value");
  loadStarted = performance.now();
  worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  const current = worker;
  worker.onmessage = ({ data }) => {
    if (worker !== current) return;
    if (data.type === "progress") {
      if (data.coverage) {
        lastCoverage = data.coverage;
        status(
          `Transcribing locally · ${data.coverage.completedChunks}/${data.coverage.totalChunks} chunks · ${(data.coverage.processedSamples / 16000).toFixed(1)} / ${(data.coverage.totalSamples / 16000).toFixed(1)} s completed. Keep the screen awake.`,
        );
        arm(600000);
      }
      $("progress").value = data.progress;
      $("progress").max = 100;
      return;
    }
    if (data.type === "error") {
      if (operation === "transcribing" && data.coverage) {
        addResult({ ...data, text: data.partialText || "" }, "failed");
        operation = "idle";
      }
      unload(
        `Model failed: ${data.message}. It may be unavailable offline or exceed available memory.`,
      );
      return;
    }
    if (data.type === "ready") {
      clearTimeout(watchdog);
      loaded = selected;
      loadMs = performance.now() - loadStarted;
      busy = false;
      operation = "idle";
      $("progress").hidden = true;
      $("model-status").textContent =
        `${selected.id} ready · load ${(loadMs / 1000).toFixed(2)} s.`;
      status("Ready. Record once, or transcribe your existing clip.");
      controls();
    }
    if (data.type === "result") {
      clearTimeout(watchdog);
      busy = false;
      $("progress").hidden = true;
      const coverage = data.coverage;
      if (
        !coverage ||
        coverage.processedSamples !== pcm.length ||
        coverage.totalSamples !== pcm.length ||
        coverage.completedChunks !== coverage.totalChunks
      ) {
        unload(
          "Worker returned an incomplete or unverified audio coverage report.",
        );
        return;
      }
      addResult(data, "complete");
      operation = "idle";
      status(
        data.text
          ? "Transcription finished locally. Review the transcript below."
          : "No text detected. Original audio is retained.",
      );
      controls();
    }
  };
  worker.onerror = () =>
    unload(
      "Worker stopped unexpectedly. The browser may have run out of memory. Try a shorter clip.",
    );
  arm();
  worker.postMessage({
    type: "load",
    model: selected,
    runtime: manifest.runtime,
    base,
  });
  controls();
}
function addResult(data, state) {
  results.push({
    model: loaded?.id || $("model").value,
    revision: loaded?.revision,
    state,
    error: data.error || data.message || null,
    modelChunkSeconds: loaded?.id === "whisper" ? 30 : 15,
    clipId: clip.id,
    clipBytes: clip.blob.size,
    audioSeconds: pcm ? pcm.length / 16000 : clip.secondsHint,
    decodeMs,
    loadMs,
    processingMs: data.milliseconds ?? null,
    wallMs: performance.now() - runStart,
    realTimeFactor:
      data.milliseconds != null && pcm
        ? data.milliseconds / 1000 / (pcm.length / 16000)
        : null,
    coverage: data.coverage,
    heapBefore: heapStart,
    heapAfter: heap(),
    deviceMemoryGB: navigator.deviceMemory ?? null,
    logicalCores: navigator.hardwareConcurrency ?? null,
    cpuThreads: 1,
    hiddenDuringRun: hidden,
    transcript: data.text || "",
  });
  render();
}
function render() {
  $("results").replaceChildren();
  for (const r of results) {
    const el = document.createElement("article");
    el.className = "result";
    const title = document.createElement("h3");
    title.textContent = `${r.model} · clip ${r.clipId} · ${r.audioSeconds?.toFixed(1) || "unknown"} s · ${r.state === "complete" ? "Complete audio coverage" : "INCOMPLETE"}`;
    const text = document.createElement("p");
    text.className = "transcript";
    text.textContent = r.transcript || "(No text detected)";
    const metrics = document.createElement("p");
    metrics.className = "metrics";
    metrics.textContent = `Load ${(r.loadMs / 1000).toFixed(2)} s · Processing ${r.processingMs == null ? "not completed" : (r.processingMs / 1000).toFixed(2) + " s"} · Elapsed wall ${(r.wallMs / 1000).toFixed(2)} s · Coverage ${((r.coverage?.processedSamples || 0) / 16000).toFixed(1)} / ${r.audioSeconds?.toFixed(1) || "unknown"} s · ${r.coverage?.completedChunks || 0}/${r.coverage?.totalChunks || "unknown"} chunks · Real-time factor ${r.realTimeFactor?.toFixed(2) || "unavailable"} (lower is faster) · Decode ${(r.decodeMs / 1000).toFixed(2)} s · JS heap ${r.heapAfter === null ? "unavailable" : mb(r.heapAfter)}. Heap is not total RAM or WASM memory.${r.hiddenDuringRun ? " Tab was hidden; timing may be affected." : ""}`;
    if (r.error) {
      const warning = document.createElement("p");
      warning.textContent = `Incomplete: ${r.error}. Original audio is retained.`;
      el.append(warning);
    }
    el.append(title, text, metrics);
    $("results").append(el);
  }
}
async function prepareAudio(blob) {
  if (blob.size > 64 * 1024 * 1024)
    throw new Error(
      "Clip is too large (64 MB maximum for transcription). Original is not truncated.",
    );
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const start = performance.now();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 301.5 || decoded.duration < 0.2)
      throw new Error(
        "Use a clip between 0.2 seconds and 5 minutes. Original is not truncated.",
      );
    if (decoded.sampleRate !== 16000)
      throw new Error(
        "Browser did not provide the required 16 kHz decoding rate.",
      );
    let samples = decoded.getChannelData(0).slice();
    if (decoded.numberOfChannels > 1) {
      samples = new Float32Array(decoded.length);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const channel = decoded.getChannelData(c);
        for (let i = 0; i < samples.length; i++)
          samples[i] += channel[i] / decoded.numberOfChannels;
      }
    }
    return { samples, milliseconds: performance.now() - start };
  } finally {
    await context.close();
  }
}
function showClip(blob, samples = null, secondsHint = null) {
  clip = { blob, id: crypto.randomUUID().slice(0, 8), secondsHint };
  pcm = samples;
  if (clipURL) URL.revokeObjectURL(clipURL);
  clipURL = URL.createObjectURL(blob);
  $("audio").src = clipURL;
  $("clip").hidden = false;
  updateClipInfo();
}
function updateClipInfo() {
  $("clip-info").textContent =
    `Clip ${clip.id} · ${pcm ? (pcm.length / 16000).toFixed(1) + " seconds" : "~" + clip.secondsHint.toFixed(1) + " seconds recorded (duration checked before inference)"} · ${mb(clip.blob.size)} · original ${clip.blob.type || "audio file"}`;
}
async function accept(blob) {
  preparing = true;
  controls();
  try {
    const prepared = await prepareAudio(blob);
    showClip(blob, prepared.samples);
    decodeMs = prepared.milliseconds;
    status("Clip ready. Download the original before running a model.");
  } catch (error) {
    status(
      `Cannot read clip: ${error.message}. Your previous clip is retained.`,
    );
  } finally {
    preparing = false;
    controls();
  }
}
async function record() {
  if (
    clip &&
    !confirm(
      "Replace the current test clip? Download it first if you want to keep it. Previous comparison results stay visible.",
    )
  )
    return;
  preparing = true;
  controls();
  try {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder)
      throw new Error("Recording unsupported");
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    abandon = false;
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => {
      status(
        "Recording was interrupted. Any received audio will be retained if decodable.",
      );
      if (recorder.state === "recording") recorder.stop();
      else cleanupRecording();
    };
    recorder.onstop = async () => {
      const canceled = abandon;
      cleanupRecording();
      if (!canceled && chunks.length) {
        showClip(
          new Blob(chunks, { type: recorder.mimeType }),
          null,
          (performance.now() - started) / 1000,
        );
        status(
          "Original recording preserved. Download it before pressing Transcribe. No transcription has started.",
        );
      } else if (!canceled) status("No audio was received. Please retry.");
      controls();
    };
    recorder.start(1000);
    preparing = false;
    started = performance.now();
    const seconds = Number($("duration").value);
    tick = setInterval(() => {
      $("record-status").textContent =
        `Recording ${Math.floor((performance.now() - started) / 1000)} / ${seconds} seconds`;
    }, 250);
    timer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, seconds * 1000);
    $("record-status").textContent = "Recording… Speak naturally.";
    controls();
  } catch (error) {
    preparing = false;
    cleanupRecording();
    status(
      `Microphone unavailable: ${error.name || error.message}. Allow microphone access on this HTTPS site, or import a saved clip.`,
    );
    controls();
  }
}
function cleanupRecording() {
  clearTimeout(timer);
  clearInterval(tick);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("record-status").textContent = "Recording stopped. Microphone released.";
}
async function run() {
  if (busy || !clip || !loaded || loaded.id !== $("model").value) return;
  busy = true;
  operation = "transcribing";
  lastCoverage = null;
  const serial = ++runSerial;
  hidden = document.hidden;
  runStart = performance.now();
  heapStart = heap();
  status(
    "Preparing completed audio locally… Original is available for download.",
  );
  $("progress").hidden = false;
  $("progress").removeAttribute("value");
  arm(600000);
  controls();
  try {
    if (!pcm) {
      preparing = true;
      controls();
      const prepared = await prepareAudio(clip.blob);
      if (serial !== runSerial) return;
      pcm = prepared.samples;
      decodeMs = prepared.milliseconds;
      updateClipInfo();
    }
    if (serial !== runSerial) return;
    status("Transcribing completed audio locally… Keep the screen awake.");
    const samples = pcm.slice();
    worker.postMessage({ type: "run", samples: samples.buffer }, [
      samples.buffer,
    ]);
  } catch (error) {
    if (serial === runSerial)
      unload(`Audio preparation failed: ${error.message}`);
  } finally {
    preparing = false;
    controls();
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$("model").onchange = () => {
  sizes();
  controls();
};
$("load").onclick = load;
$("record").onclick = record;
$("stop").onclick = () => recorder?.state === "recording" && recorder.stop();
$("discard").onclick = () => {
  abandon = true;
  if (recorder?.state === "recording") recorder.stop();
  status("Recording canceled. Previous clip is retained.");
};
$("cancel").onclick = () => unload("Canceled; model unloaded.");
$("run").onclick = run;
$("file").onchange = async () => {
  const file = $("file").files[0];
  if (
    file &&
    (!clip ||
      confirm("Replace the current clip? Download it first to keep it."))
  )
    await accept(file);
  $("file").value = "";
};
$("save-audio").onclick = () => {
  const ext = clip.blob.type.includes("mpeg")
    ? "mp3"
    : clip.blob.type.includes("flac")
      ? "flac"
      : clip.blob.type.includes("aac")
        ? "aac"
        : clip.blob.type.includes("mp4")
          ? "m4a"
          : clip.blob.type.includes("ogg")
            ? "ogg"
            : clip.blob.type.includes("wav")
              ? "wav"
              : "webm";
  download(clip.blob, `benchmark-${clip.id}.${ext}`);
};
$("report").onclick = () =>
  download(
    new Blob(
      [
        JSON.stringify(
          {
            created: new Date().toISOString(),
            runtime: manifest.onnx,
            transformers: manifest.transformers,
            results,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    "local-benchmark-results.json",
  );
document.addEventListener("visibilitychange", () => {
  if (busy && document.hidden) hidden = true;
});
window.addEventListener("pagehide", () => {
  cleanupRecording();
  worker?.terminate();
});
window.addEventListener("offline", () =>
  status(
    loaded
      ? "Offline: the loaded model can still transcribe this clip in this tab."
      : "Offline: load requires internet. Your current clip remains available for download.",
  ),
);
try {
  const response = await fetch(base + "manifest.json");
  if (!response.ok) throw new Error("Manifest unavailable");
  manifest = await response.json();
  sizes();
  $("load").textContent = "Load selected model";
  controls();
} catch {
  status(
    "Pinned model manifest unavailable. Check your connection and reload. Recording and audio import still work.",
  );
  controls();
}
