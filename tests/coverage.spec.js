import { test, expect } from "@playwright/test";
import { transcribeComplete } from "../src/transcribe.js";
for (const model of ["whisper", "moonshine"])
  for (const seconds of [180, 300.25]) {
    test(`${model} covers every sample of ${seconds}s including final partial chunk`, async () => {
      const samples = new Float32Array(seconds * 16000);
      samples[samples.length - 1] = 0.75;
      let offset = 0,
        calls = 0,
        tail;
      const fake = async (input, options) => {
        expect(input.buffer).toBe(samples.buffer);
        expect(input.byteOffset).toBe(offset * 4);
        offset += input.length;
        calls++;
        tail = input.at(-1);
        options.streamer.put([[2n]]);
        return { text: `segment ${calls}` };
      };
      fake.model = { config: { eos_token_id: 2 } };
      const result = await transcribeComplete(fake, model, samples);
      expect(offset).toBe(samples.length);
      expect(tail).toBe(0.75);
      expect(result.coverage.processedSamples).toBe(samples.length);
      expect(result.coverage.ranges.at(-1).endSample).toBe(samples.length);
      for (let i = 1; i < result.coverage.ranges.length; i++)
        expect(result.coverage.ranges[i].startSample).toBe(
          result.coverage.ranges[i - 1].endSample,
        );
      expect(result.text).toContain(
        `segment ${Math.ceil(seconds / (model === "whisper" ? 30 : 15))}`,
      );
    });
  }
test("decoder token limit fails visibly, preserving previous completed chunks instead of claiming complete", async () => {
  let calls = 0;
  const fake = async (input, options) => {
    calls++;
    options.streamer.put([[calls === 1 ? 2n : 99n]]);
    return { text: "completed first chunk" };
  };
  fake.model = { config: { eos_token_id: 2 } };
  try {
    await transcribeComplete(fake, "moonshine", new Float32Array(60 * 16000));
    throw new Error("Expected limit rejection");
  } catch (error) {
    expect(error.message).toContain("Decoder output limit");
    expect(error.coverage.processedSamples).toBe(15 * 16000);
    expect(error.partialText).toBe("completed first chunk");
  }
});
test("runtime failure near end cannot report full coverage", async () => {
  let calls = 0;
  const fake = async (input, options) => {
    if (++calls === 20) throw new Error("Runtime failed at tail");
    options.streamer.put([[2n]]);
    return { text: "fictional" };
  };
  fake.model = { config: { eos_token_id: 2 } };
  await expect(
    transcribeComplete(fake, "moonshine", new Float32Array(300 * 16000)),
  ).rejects.toMatchObject({
    message: "Runtime failed at tail",
    coverage: {
      processedSamples: 285 * 16000,
      completedChunks: 19,
      totalChunks: 20,
    },
  });
});
test("even a forced end token at the output safety cap is rejected as incomplete", async () => {
  const fake = async (input, options) => {
    options.streamer.put([[1n]]);
    for (let i = 0; i < 256; i++) options.streamer.put([[i === 255 ? 2n : 3n]]);
    return { text: "capped" };
  };
  fake.model = { config: { eos_token_id: 2 } };
  await expect(
    transcribeComplete(fake, "moonshine", new Float32Array(16000)),
  ).rejects.toThrow("Decoder output limit");
});
