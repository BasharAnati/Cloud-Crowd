"use strict";

const DEADLINES_MS = Object.freeze({
  connect: 5_000,
  query: 15_000,
  rollback: 5_000,
  close: 5_000,
});

function boundedAwait(promise, deadlineName, createTimeoutError) {
  const milliseconds = DEADLINES_MS[deadlineName];
  if (!Object.hasOwn(DEADLINES_MS, deadlineName)) {
    throw new TypeError("Unknown internal deadline");
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createTimeoutError()), milliseconds);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    clearTimeout(timer);
  });
}

module.exports = { DEADLINES_MS, boundedAwait };
