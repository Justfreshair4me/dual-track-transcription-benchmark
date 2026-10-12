import { test, expect } from "@playwright/test";
import fs from "node:fs";
function wav(seconds) {
  const n = seconds * 16000,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(
      Math.sin((i * 2 * Math.PI * 220) / 16000) * 1500,
      44 + i * 2,
    );
  return b;
}
const workerCode = `let model;self.onmessage=({data})=>{if(data.type==='load'){model=data.model.id;setTimeout(()=>self.postMessage({type:'ready',milliseconds:123}),50);}else if(data.type==='run'){const samples=new Float32Array(data.samples);self.postMessage({type:'result',text:'Fictional '+model+' transcript. Samples '+samples.length,milliseconds:150});}};`;
async function mock(page, code = workerCode) {
  await page.route(/\/assets\/worker-.*\.js$/, (route) =>
    route.fulfill({ contentType: "text/javascript", body: code }),
  );
}
async function open(page) {
  await page.goto("./");
  await expect(page.locator("#load")).toBeEnabled();
}
async function load(page) {
  page.once("dialog", (d) => d.accept());
  await page.locator("#load").click();
  await expect(page.locator("#model-status")).toContainText("ready");
}
async function clip(page, seconds = 15) {
  await page.locator("#file").setInputFiles({
    name: "fictional.wav",
    mimeType: "audio/wav",
    buffer: wav(seconds),
  });
  await expect(page.locator("#clip")).toBeVisible();
}
test("production styling, subdirectory assets, no errors, no automatic model downloads", async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await open(page);
  await expect(page.locator("#download-size")).toContainText("45.09 MB");
  expect(
    await page
      .locator("#record")
      .evaluate((e) => getComputedStyle(e).borderRadius),
  ).toBe("50%");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.emulateMedia({ colorScheme: "dark" });
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
  ).toBe("rgb(14, 22, 35)");
  expect(errors).toEqual([]);
  expect(
    requests.some((u) => /\/models\/|\.wasm$|\/assets\/worker-/.test(u)),
  ).toBeFalsy();
});
test("downloads require explicit confirmation", async ({ page }) => {
  await open(page);
  let workerRequested = false;
  page.on("request", (r) => {
    if (r.url().includes("/assets/worker-")) workerRequested = true;
  });
  page.once("dialog", (d) => {
    expect(d.message()).toContain("66.73 MB");
    d.dismiss();
  });
  await page.locator("#load").click();
  expect(workerRequested).toBeFalsy();
  await expect(page.locator("#model-status")).not.toContainText("ready");
});
for (const seconds of [15, 30, 60])
  test(`${seconds}s same completed clip reused by both models, PCM length and playback preserved`, async ({
    page,
  }) => {
    await mock(page);
    await open(page);
    await clip(page, seconds);
    const src = await page.locator("#audio").getAttribute("src");
    await load(page);
    await page.locator("#run").click();
    await expect(page.locator(".transcript")).toContainText(
      "Samples " + seconds * 16000,
    );
    await page.locator("#model").selectOption("moonshine");
    await load(page);
    await page.locator("#run").click();
    await expect(page.locator(".result")).toHaveCount(2);
    await expect(page.locator(".transcript").last()).toContainText(
      "Fictional moonshine",
    );
    const titles = await page.locator(".result h3").allTextContents();
    expect(titles[0].split("clip ")[1]).toBe(titles[1].split("clip ")[1]);
    expect(await page.locator("#audio").getAttribute("src")).toBe(src);
    await page.locator("#audio").evaluate(async (a) => {
      await a.play();
      a.pause();
    });
    const download = page.waitForEvent("download");
    await page.locator("#save-audio").click();
    const file = await (await download).path();
    expect(fs.readFileSync(file)).toEqual(wav(seconds));
  });
test("cancellation during load and inference releases worker and retains original", async ({
  page,
}) => {
  await mock(page, `self.onmessage=()=>{};`);
  await open(page);
  await clip(page);
  const src = await page.locator("#audio").getAttribute("src");
  page.once("dialog", (d) => d.accept());
  await page.locator("#load").click();
  await expect(page.locator("#save-audio")).toBeEnabled();
  await page.locator("#cancel").click();
  await expect(page.locator("#status")).toContainText("Canceled");
  await expect(page.locator("#load")).toBeEnabled();
  expect(await page.locator("#audio").getAttribute("src")).toBe(src);
  await mock(
    page,
    `self.onmessage=({data})=>{if(data.type==='load')self.postMessage({type:'ready',milliseconds:1});};`,
  );
  await load(page);
  await page.locator("#run").click();
  await expect(page.locator("#save-audio")).toBeEnabled();
  await page.locator("#cancel").click();
  await expect(page.locator("#run")).toBeDisabled();
  expect(await page.locator("#audio").getAttribute("src")).toBe(src);
});
test("model errors and unexpected worker failure retain audio and permit retry", async ({
  page,
}) => {
  await mock(
    page,
    `self.onmessage=()=>self.postMessage({type:'error',message:'Insufficient memory'});`,
  );
  await open(page);
  await clip(page);
  page.once("dialog", (d) => d.accept());
  await page.locator("#load").click();
  await expect(page.locator("#status")).toContainText("Insufficient memory");
  await expect(page.locator("#load")).toBeEnabled();
  await expect(page.locator("#clip")).toBeVisible();
  await mock(page, `self.onmessage=()=>{throw new Error('Worker failure');};`);
  page.once("dialog", (d) => d.accept());
  await page.locator("#load").click();
  await expect(page.locator("#status")).toContainText(
    "Worker stopped unexpectedly",
  );
  await expect(page.locator("#clip")).toBeVisible();
});
test("damaged and oversized imports do not replace existing audio", async ({
  page,
}) => {
  await open(page);
  await clip(page);
  const src = await page.locator("#audio").getAttribute("src");
  page.once("dialog", (d) => d.accept());
  await page.locator("#file").setInputFiles({
    name: "bad.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not audio"),
  });
  await expect(page.locator("#status")).toContainText("Cannot read clip");
  expect(await page.locator("#audio").getAttribute("src")).toBe(src);
  page.once("dialog", (d) => d.accept());
  await page.locator("#file").setInputFiles({
    name: "too-long.wav",
    mimeType: "audio/wav",
    buffer: wav(65),
  });
  await expect(page.locator("#status")).toContainText("60 seconds");
  expect(await page.locator("#audio").getAttribute("src")).toBe(src);
});
test("real MediaRecorder captures once, downloads original, releases microphone", async ({
  page,
}) => {
  await open(page);
  await page.locator("#record").click();
  await expect(page.locator("#stop")).toBeEnabled();
  await page.waitForTimeout(1250);
  await page.locator("#stop").click();
  await expect(page.locator("#clip")).toBeVisible();
  await expect(page.locator("#record-status")).toContainText(
    "Microphone released",
  );
  await page.locator("#audio").evaluate(async (a) => {
    await a.play();
    a.pause();
  });
  const download = page.waitForEvent("download");
  await page.locator("#save-audio").click();
  expect(fs.statSync(await (await download).path()).size).toBeGreaterThan(100);
});
test("offline loaded model runs, no persistent stores touched, no upload requests", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error("IndexedDB access forbidden");
    };
    caches.open = () => {
      throw new Error("CacheStorage access forbidden");
    };
    navigator.serviceWorker.register = () => {
      throw new Error("SW registration forbidden");
    };
  });
  const unsafe = [];
  page.on("request", (r) => {
    if (
      r.method() !== "GET" ||
      (!r.url().startsWith("blob:") &&
        new URL(r.url()).hostname !== "127.0.0.1")
    )
      unsafe.push(r.url());
  });
  await mock(page);
  await open(page);
  await clip(page);
  await load(page);
  await context.setOffline(true);
  await page.locator("#run").click();
  await expect(page.locator(".transcript")).toContainText("Fictional whisper");
  expect(unsafe).toEqual([]);
});
test("recording cancellation preserves previous clip", async ({ page }) => {
  await open(page);
  await clip(page);
  const src = await page.locator("#audio").getAttribute("src");
  page.once("dialog", (d) => d.accept());
  await page.locator("#record").click();
  await expect(page.locator("#discard")).toBeEnabled();
  await page.locator("#discard").click();
  await expect(page.locator("#status")).toContainText("canceled");
  expect(await page.locator("#audio").getAttribute("src")).toBe(src);
});
test("loaded model automatically transcribes stopped real recording", async ({
  page,
}) => {
  await mock(page);
  await open(page);
  await load(page);
  await page.locator("#record").click();
  await expect(page.locator("#stop")).toBeEnabled();
  await page.waitForTimeout(1100);
  await page.locator("#stop").click();
  await expect(page.locator(".transcript")).toContainText("Fictional whisper");
  await expect(page.locator("#record-status")).toContainText(
    "Microphone released",
  );
  await expect(page.locator("#audio")).toHaveAttribute("src", /^blob:/);
});
test("microphone permission failure offers import without damaging existing clip", async ({
  page,
  context,
}) => {
  await open(page);
  await clip(page);
  const src = await page.locator("#audio").getAttribute("src");
  await context.clearPermissions();
  await context.grantPermissions([]);
  await page.evaluate(
    () =>
      (navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("Denied", "NotAllowedError");
      }),
  );
  page.once("dialog", (d) => d.accept());
  await page.locator("#record").click();
  await expect(page.locator("#status")).toContainText("NotAllowedError");
  expect(await page.locator("#audio").getAttribute("src")).toBe(src);
  await expect(page.locator("#file")).toBeEnabled();
});
for (const seconds of [15, 30, 60]) {
  test(`automatic ${seconds}s recording stop with simulated clock releases microphone and retains clip`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ encoded }) => {
        window.testTrackStopped = false;
        navigator.mediaDevices.getUserMedia = async () => ({
          getTracks: () => [
            {
              stop: () => {
                window.testTrackStopped = true;
              },
            },
          ],
        });
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        window.MediaRecorder = class {
          static isTypeSupported() {
            return false;
          }
          state = "inactive";
          mimeType = "audio/wav";
          start() {
            this.state = "recording";
          }
          stop() {
            this.state = "inactive";
            this.ondataavailable({
              data: new Blob([bytes], { type: "audio/wav" }),
            });
            this.onstop();
          }
        };
      },
      { encoded: wav(seconds).toString("base64") },
    );
    await open(page);
    await page.clock.install();
    await page.locator("#duration").selectOption(String(seconds));
    await page.locator("#record").click();
    await expect(page.locator("#stop")).toBeEnabled();
    await page.clock.fastForward(seconds * 1000);
    await expect(page.locator("#clip-info")).toContainText(
      `${seconds}.0 seconds`,
    );
    expect(await page.evaluate(() => window.testTrackStopped)).toBeTruthy();
    await expect(page.locator("#record")).toBeEnabled();
  });
}
