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
  loadStarted = 0;
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
    !clip ||
    !pcm ||
    !loaded ||
    loaded.id !== $("model").value ||
    locked ||
    recording;
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
function arm() {
  clearTimeout(watchdog);
  watchdog = setTimeout(
    () =>
      unload(
        "Processing timed out after five minutes; retry with a shorter clip.",
      ),
    300000,
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
      $("progress").value = data.progress;
      $("progress").max = 100;
      return;
    }
    if (data.type === "error") {
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
      const item = {
        model: loaded.id,
        revision: loaded.revision,
        clipId: clip.id,
        clipBytes: clip.blob.size,
        audioSeconds: pcm.length / 16000,
        decodeMs,
        loadMs,
        processingMs: data.milliseconds,
        wallMs: performance.now() - runStart,
        realTimeFactor: data.milliseconds / 1000 / (pcm.length / 16000),
        heapBefore: heapStart,
        heapAfter: heap(),
        deviceMemoryGB: navigator.deviceMemory ?? null,
        logicalCores: navigator.hardwareConcurrency ?? null,
        cpuThreads: 1,
        hiddenDuringRun: hidden,
        transcript: data.text,
      };
      results.push(item);
      render();
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
function render() {
  $("results").replaceChildren();
  for (const r of results) {
    const el = document.createElement("article");
    el.className = "result";
    const title = document.createElement("h3");
    title.textContent = `${r.model} · clip ${r.clipId} · ${r.audioSeconds.toFixed(1)} s`;
    const text = document.createElement("p");
    text.className = "transcript";
    text.textContent = r.transcript || "(No text detected)";
    const metrics = document.createElement("p");
    metrics.className = "metrics";
    metrics.textContent = `Load ${(r.loadMs / 1000).toFixed(2)} s · Processing ${(r.processingMs / 1000).toFixed(2)} s · Real-time factor ${r.realTimeFactor.toFixed(2)} (lower is faster) · Decode ${(r.decodeMs / 1000).toFixed(2)} s · JS heap ${r.heapAfter === null ? "unavailable" : mb(r.heapAfter)}. Heap is not total RAM or WASM memory.${r.hiddenDuringRun ? " Tab was hidden; timing may be affected." : ""}`;
    el.append(title, text, metrics);
    $("results").append(el);
  }
}
async function accept(blob, recorded = false) {
  preparing = true;
  controls();
  const previous = clip,
    start = performance.now();
  let context;
  try {
    if (blob.size > 15 * 1024 * 1024)
      throw new Error("Clip is too large (15 MB maximum).");
    context = new AudioContext();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 61.5 || decoded.duration < 0.2)
      throw new Error("Use a clip between 0.2 and 60 seconds.");
    const offline = new OfflineAudioContext(
        1,
        Math.ceil(decoded.duration * 16000),
        16000,
      ),
      source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    pcm = rendered.getChannelData(0).slice();
    decodeMs = performance.now() - start;
    clip = { blob, id: crypto.randomUUID().slice(0, 8) };
    if (clipURL) URL.revokeObjectURL(clipURL);
    clipURL = URL.createObjectURL(blob);
    $("audio").src = clipURL;
    $("clip").hidden = false;
    $("clip-info").textContent =
      `Clip ${clip.id} · ${(pcm.length / 16000).toFixed(1)} seconds · ${mb(blob.size)} · original ${blob.type || "audio file"}`;
    status("Clip ready. Download the original before running a model.");
    return true;
  } catch (error) {
    clip = previous;
    if (recorded) {
      pcm = null;
      clip = { blob, id: crypto.randomUUID().slice(0, 8) };
      if (clipURL) URL.revokeObjectURL(clipURL);
      clipURL = URL.createObjectURL(blob);
      $("audio").src = clipURL;
      $("clip").hidden = false;
      $("clip-info").textContent =
        "Original recording retained; could not prepare bounded audio for transcription.";
    }
    status(
      `Cannot read clip: ${error.message}. ${recorded ? "Original recording is available for download." : "Your previous clip is retained."}`,
    );
    return false;
  } finally {
    await context?.close();
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
        const accepted = await accept(
          new Blob(chunks, { type: recorder.mimeType }),
          true,
        );
        if (accepted && loaded && loaded.id === $("model").value) run();
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
function run() {
  if (busy || !clip || !pcm || !loaded || loaded.id !== $("model").value)
    return;
  busy = true;
  hidden = document.hidden;
  runStart = performance.now();
  heapStart = heap();
  status("Transcribing completed audio locally… Keep the screen awake.");
  $("progress").hidden = false;
  $("progress").removeAttribute("value");
  arm();
  const samples = pcm.slice();
  worker.postMessage({ type: "run", samples: samples.buffer }, [
    samples.buffer,
  ]);
  controls();
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
