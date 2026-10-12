import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir("public/runtime", { recursive: true });
const runtime = [];
for (const name of [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
]) {
  const from = `node_modules/onnxruntime-web/dist/${name}`,
    data = await readFile(from);
  await copyFile(from, `public/runtime/${name}`);
  runtime.push({
    path: `runtime/${name}`,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
await writeFile(
  "public/manifest.json",
  JSON.stringify(
    {
      ...JSON.parse(await readFile("models.lock.json", "utf8")),
      runtime,
      transformers: "3.8.1",
      onnx: "1.22.0-dev.20250409-89f8206ba4",
    },
    null,
    2,
  ),
);
