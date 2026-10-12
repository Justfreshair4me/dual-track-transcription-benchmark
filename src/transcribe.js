/** Sequential bounded inference with explicit audio coverage and decoder-end checks. */
export async function transcribeComplete(
  transcriber,
  modelId,
  samples,
  onProgress = () => {},
) {
  const rate = 16000;
  if (
    !(samples instanceof Float32Array) ||
    !samples.length ||
    samples.length > Math.ceil(301.5 * rate)
  )
    throw new Error(
      "Audio must be nonempty and no longer than five minutes (plus stop timing tolerance).",
    );
  const length = 15 * rate;
  const totalChunks = Math.ceil(samples.length / length);
  const ranges = [];
  let text = "";
  const coverage = () => ({
    totalSamples: samples.length,
    processedSamples: ranges.at(-1)?.endSample || 0,
    completedChunks: ranges.length,
    totalChunks,
    ranges: [...ranges],
  });
  try {
    for (let start = 0; start < samples.length; start += length) {
      const end = Math.min(start + length, samples.length);
      let lastToken,
        calls = 0,
        generatedTokens = 0;
      const maxTokens = modelId === "whisper" ? 440 : 256;
      const streamer = {
        put(batch) {
          if (calls++ > 0) generatedTokens += batch[0].length;
          lastToken = Number(batch[0].at(-1));
        },
        end() {},
      };
      const eos =
        transcriber.model.generation_config?.eos_token_id ??
        transcriber.model.config.eos_token_id;
      if (eos == null)
        throw new Error("Cannot verify this model decoder completion.");
      const result = await transcriber(samples.subarray(start, end), {
        ...(modelId === "whisper"
          ? { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false }
          : { max_new_tokens: maxTokens }),
        streamer,
      });
      const ended = (Array.isArray(eos) ? eos : [eos])
        .map(Number)
        .includes(lastToken);
      if (!ended || generatedTokens >= maxTokens)
        throw new Error(
          `Decoder output limit or unexpected end in chunk ${ranges.length + 1} (${(start / rate).toFixed(1)}–${(end / rate).toFixed(1)} s). This transcript is incomplete.`,
        );
      text += (text ? " " : "") + result.text.trim();
      ranges.push({ startSample: start, endSample: end, decoderEnded: true });
      onProgress({ ...coverage(), partialText: text });
    }
    return { text: text.trim(), coverage: coverage() };
  } catch (error) {
    error.partialText = text;
    error.coverage = coverage();
    throw error;
  }
}
