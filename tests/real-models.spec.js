import { test, expect } from "@playwright/test";
// Deliberately separate from simulated UI tests. CI installs verified real weights and synthetic speech.
if (process.env.REAL_MODELS === "1") {
  for (const seconds of [15, 30, 60])
    test(`REAL wasm q8: both models transcribe the same ${seconds}s completed clip offline`, async ({
      page,
      context,
    }) => {
      test.setTimeout(300000);
      const errors = [],
        network = [];
      page.on("pageerror", (e) => errors.push(e.message));
      context.on("request", (r) =>
        network.push({ url: r.url(), method: r.method() }),
      );
      await page.goto("./");
      await expect(page.locator("#load")).toBeEnabled();
      expect(await page.locator("#record").evaluate(e => getComputedStyle(e).borderRadius)).toBe("50%");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page
        .locator("#file")
        .setInputFiles(`public/fixtures/${seconds}.wav`);
      for (const model of ["whisper", "moonshine"]) {
        await context.setOffline(false);
        await page.locator("#model").selectOption(model);
        page.once("dialog", (d) => d.accept());
        await page.locator("#load").click();
        await expect(page.locator("#status")).toContainText(
          /Ready\.|Model failed:|Worker stopped unexpectedly/,
          { timeout: 120000 },
        );
        if (
          !(await page.locator("#model-status").textContent()).includes("ready")
        )
          throw new Error(
            "Real " +
              model +
              " initialization: " +
              (await page.locator("#status").textContent()),
          );
        await context.setOffline(true);
        await page.locator("#run").click();
        await expect(page.locator("#status")).toContainText(
          /Transcription finished|No text detected|Model failed:|Worker stopped unexpectedly/,
          { timeout: 180000 },
        );
        if (
          !(await page.locator("#status").textContent()).includes(
            "Transcription finished",
          )
        )
          throw new Error(
            "Real " +
              model +
              " inference: " +
              (await page.locator("#status").textContent()),
          );
        await expect(page.locator(".result")).toHaveCount(
          model === "whisper" ? 1 : 2,
        );
        await expect(page.locator(".transcript").last()).toContainText(
          /garden|flowers|book|birds|friend/i,
        );
      }
      await expect(page.locator(".result")).toHaveCount(2);
      const titles = await page.locator(".result h3").allTextContents();
      expect(titles[0].split("clip ")[1]).toBe(titles[1].split("clip ")[1]);
      await page.locator("#audio").evaluate(async (a) => {
        await a.play();
        a.pause();
      });
      expect(errors).toEqual([]);
      const stores = await page.evaluate(async () => ({
        databases: await indexedDB.databases(),
        caches: await caches.keys(),
        registrations: (await navigator.serviceWorker.getRegistrations())
          .length,
      }));
      expect(stores).toEqual({ databases: [], caches: [], registrations: 0 });
      const reportEvent = page.waitForEvent("download");
      await page.locator("#report").click();
      const report = await reportEvent;
      const reportPath = test.info().outputPath("real-model-results.json");
      await report.saveAs(reportPath);
      await test
        .info()
        .attach("real-model-metrics", {
          path: reportPath,
          contentType: "application/json",
        });
      expect(
        network.filter(
          (r) =>
            r.method !== "GET" ||
            (!r.url.startsWith("blob:") &&
              new URL(r.url).origin !== new URL(page.url()).origin),
        ),
      ).toEqual([]);
    });
}
