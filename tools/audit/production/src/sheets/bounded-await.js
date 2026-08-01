"use strict";

const { SheetsTimeoutError } = require("../errors");

const DEADLINES_MS = Object.freeze({ authorization: 10_000, request: 15_000, readAll: 75_000, retryDelay: 250 });

function boundedAwait(promise, deadlineName, controller) {
  if (!Object.hasOwn(DEADLINES_MS, deadlineName) || deadlineName === "retryDelay") throw new TypeError("Unknown Sheets deadline");
  let timer;
  let abort;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new SheetsTimeoutError("Sheets operation timed out"));
    }, DEADLINES_MS[deadlineName]);
  });
  const aborted = new Promise((_, reject) => {
    if (!controller) return;
    abort = () => reject(new SheetsTimeoutError("Sheets operation timed out"));
    if (controller.signal.aborted) abort();
    else controller.signal.addEventListener("abort", abort, { once: true });
  });
  return Promise.race([Promise.resolve(promise), timeout, aborted]).finally(() => {
    clearTimeout(timer);
    if (controller && abort) controller.signal.removeEventListener("abort", abort);
  });
}

function retryDelay(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SheetsTimeoutError("Sheets operation timed out"));
      return;
    }
    let timer = setTimeout(done, DEADLINES_MS.retryDelay);
    function done() {
      if (signal) signal.removeEventListener("abort", aborted);
      timer = undefined;
      resolve();
    }
    function aborted() {
      if (timer !== undefined) clearTimeout(timer);
      reject(new SheetsTimeoutError("Sheets operation timed out"));
    }
    if (signal) signal.addEventListener("abort", aborted, { once: true });
  });
}

module.exports = { DEADLINES_MS, boundedAwait, retryDelay };
