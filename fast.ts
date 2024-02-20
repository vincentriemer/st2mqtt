import * as browsers from "@puppeteer/browsers";
import os from "os";
import puppeteer from "puppeteer-core";
import { PUPPETEER_REVISIONS } from "puppeteer-core/internal/revisions.js";
import Observable from "zen-observable";
import { isDeepStrictEqual } from "util";

export interface FastOptions {
  measureUpload?: boolean;
}

export interface FastResult {
  downloadSpeed: number | null;
  uploadSpeed: number | null;
  downloadUnit: string | null;
  downloaded: number | null;
  uploadUnit: string | null;
  uploaded: number | null;
  latency: number | null;
  bufferBloat: number | null;
  userLocation: string | null;
  userIp: string | null;
  isDone: boolean;
}

// ensure the browser is installed.
// NB this is required because Bun does not execute arbitrary dependencies
//    lifecycle scripts, such as postinstall. even if it did, currently,
//    puppeteer assumes node is being used, so that would not work either.
//    see https://github.com/puppeteer/puppeteer/blob/puppeteer-v21.6.1/packages/puppeteer/package.json#L41
//    see https://bun.sh/docs/cli/install#trusted-dependencies
async function installBrowser() {
  let downloaded = false;
  const chromeVersion = PUPPETEER_REVISIONS["chrome-headless-shell"];
  return await browsers.install({
    browser: browsers.Browser.CHROMEHEADLESSSHELL,
    buildId: chromeVersion,
    cacheDir: `${os.homedir()}/.cache/puppeteer`,
    downloadProgressCallback: () => {
      if (!downloaded) {
        console.log(`Downloading the browser Chrome/${chromeVersion}...`);
        downloaded = true;
      }
    },
  });
}

async function getChromeExecutablePath() {
  const envPath = import.meta.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath == null) {
    const browser = await installBrowser();
    return browser.executablePath;
  }
  return envPath;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function init(
  browser: puppeteer.Browser,
  page: puppeteer.Page,
  observer: ZenObservable.SubscriptionObserver<FastResult>,
  options: FastOptions
) {
  let previousResult: FastResult | null = null;

  while (true) {
    const result = await page.evaluate((): FastResult => {
      const $ = document.querySelector.bind(document);

      const speedValue = $("#speed-value")?.textContent;
      const uploadValue = $("#upload-value")?.textContent;
      const downloadUnit = $("#speed-units")?.textContent?.trim();
      const downloaded = $("#down-mb-value")?.textContent?.trim();
      const uploadUnit = $("#upload-units")?.textContent?.trim();
      const uploaded = $("#up-mb-value")?.textContent?.trim();
      const latency = $("#latency-value")?.textContent?.trim();
      const bufferBloat = $("#bufferbloat-value")?.textContent?.trim();
      const userLocation = $("#user-location")?.textContent?.trim();
      const userIp = $("#user-ip")?.textContent?.trim();
      const isDone = Boolean(
        $("#speed-value.succeeded") && $("#upload-value.succeeded")
      );

      const coerceToNumberOrNull = (
        value: string | null | undefined
      ): number | null => {
        return value != null ? Number(value) : null;
      };

      return {
        downloadSpeed: coerceToNumberOrNull(speedValue),
        uploadSpeed: coerceToNumberOrNull(uploadValue),
        downloadUnit: downloadUnit ?? null,
        downloaded: coerceToNumberOrNull(downloaded),
        uploadUnit: uploadUnit ?? null,
        uploaded: coerceToNumberOrNull(uploaded),
        latency: coerceToNumberOrNull(latency),
        bufferBloat: coerceToNumberOrNull(bufferBloat),
        userLocation: userLocation ?? null,
        userIp: userIp ?? null,
        isDone,
      };
    });

    if (
      result.downloadSpeed !== null &&
      result.downloadSpeed > 0 &&
      !isDeepStrictEqual(result, previousResult)
    ) {
      observer.next(result);
    }

    if (
      result.isDone ||
      (options.measureUpload !== true && result.uploadSpeed !== null)
    ) {
      browser.close();
      observer.complete();
      return;
    }

    previousResult = result;

    await delay(100);
  }
}

export default async function runFastTest(
  options: FastOptions
): Promise<Observable<FastResult>> {
  const executablePath = await getChromeExecutablePath();
  return new Observable((observer) => {
    puppeteer
      .launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox"],
      })
      .then((browser) => {
        return Promise.all([browser, browser.newPage()]);
      })
      .then(([browser, page]) => {
        return Promise.all([browser, page, page.goto("https://fast.com")]);
      })
      .then(([browser, page]) => {
        return init(browser, page, observer, options);
      })
      .catch(observer.error.bind(observer));
  });
}
