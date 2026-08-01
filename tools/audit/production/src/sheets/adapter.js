"use strict";

const {
  MalformedSheetsResponseError,
  SheetsAuthenticationError,
  SheetsConfigurationError,
  SheetsInputError,
  SheetsInvalidRangeError,
  SheetsNotFoundError,
  SheetsPermissionError,
  SheetsRateLimitError,
  SheetsTimeoutError,
  UnexpectedSheetStructureError,
  classifyError,
} = require("../errors");
const { verifyReadOnlyCapability } = require("../safety-kernel");
const { DEADLINES_MS, boundedAwait, retryDelay } = require("./bounded-await");
const { buildSheetsConfiguration, readSheetsEnvironment } = require("./configuration");
const { parseCredentials } = require("./credentials");
const { LIMITS, deepFreeze, validateBatchGetResponse } = require("./row-validation");
const { annotateSnapshot } = require("./structure");

const READ_ONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const RETRYABLE_STATUS = Object.freeze([429, 500, 502, 503, 504]);

const OPERATIONS = Object.freeze({
  CCTV: "cctv",
  CUSTOMER_EXPERIENCE: "customer-experience",
  COMPLAINTS: "complaints",
  COMPLIMENTARY_ORDERS: "complimentary-orders",
  ALL: "all",
});

const TRUSTED_SHEETS_SNAPSHOTS = new WeakSet();

function verifyTrustedSheetsSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !TRUSTED_SHEETS_SNAPSHOTS.has(snapshot)) {
    throw new TypeError("Google Sheets snapshot is not trusted");
  }
}

function rejectArguments(args) {
  if (args.length !== 0) return Promise.reject(new SheetsInputError("Sheets operations do not accept arguments"));
  return null;
}

function defaultGoogleFactory() {
  return require("googleapis").google;
}

function safeOwnDataValue(object, property) {
  try {
    if (!object || (typeof object !== "object" && typeof object !== "function")) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, property);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch (_) {
    return undefined;
  }
}

function safeDataMethod(object, property) {
  try {
    let current = object;
    const seen = new Set();
    while (current && (typeof current === "object" || typeof current === "function")) {
      if (seen.has(current) || seen.size >= 16) return undefined;
      seen.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, property);
      if (descriptor) return Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function" ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current);
    }
  } catch (_) {
    return undefined;
  }
  return undefined;
}

function statusFromError(error) {
  const response = safeOwnDataValue(error, "response");
  const status = safeOwnDataValue(response, "status");
  return Number.isInteger(status) ? status : null;
}

function classifiedRequestError(error) {
  if (classifyError(error).publicCode === "SHEETS_TIMEOUT") return error;
  const status = statusFromError(error);
  if (status === 400) return new SheetsInvalidRangeError("Sheets range was rejected");
  if (status === 401) return new SheetsAuthenticationError("Sheets request authentication failed");
  if (status === 403) return new SheetsPermissionError("Sheets request was denied");
  if (status === 404) return new SheetsNotFoundError("Configured Sheet was not found");
  if (status === 429) return new SheetsRateLimitError("Sheets request was rate limited");
  return new MalformedSheetsResponseError("Sheets request failed without a valid response");
}

function constructSheetsSession(credentials, googleFactory = defaultGoogleFactory) {
  try {
    const google = googleFactory();
    if (!google || typeof google !== "object" || !google.auth || typeof google.auth.JWT !== "function" || typeof google.sheets !== "function") {
      throw new TypeError("Invalid Google client factory");
    }
    const auth = new google.auth.JWT({
      email: credentials.clientEmail,
      key: credentials.privateKey,
      scopes: [READ_ONLY_SCOPE],
    });
    const sheets = google.sheets({ version: "v4", auth });
    if (!auth || typeof auth.authorize !== "function" || !sheets || typeof sheets !== "object") throw new TypeError("Invalid Google client");
    return { auth, sheets };
  } catch (_) {
    throw new SheetsAuthenticationError("Sheets client construction failed");
  }
}

function installAuthorizationTransport(auth, controller) {
  try {
    const transporter = safeOwnDataValue(auth, "transporter");
    const request = safeDataMethod(transporter, "request");
    if (typeof request !== "function") throw new TypeError("Invalid Google authorization transport");
    const boundedTransporter = Object.freeze({
      request(options) {
        const boundedOptions = {
          ...(options && typeof options === "object" ? options : {}),
          timeout: DEADLINES_MS.authorization,
          retry: false,
          signal: controller.signal,
        };
        return request.call(transporter, boundedOptions);
      },
    });
    auth.transporter = boundedTransporter;
    if (auth.transporter !== boundedTransporter) throw new TypeError("Google authorization transport could not be bounded");
    return { boundedTransporter, transporter };
  } catch (_) {
    throw new SheetsAuthenticationError("Sheets authorization transport is invalid");
  }
}

function restoreAuthorizationTransport(auth, installed) {
  try {
    if (auth.transporter !== installed.boundedTransporter) throw new TypeError("Google authorization transport changed unexpectedly");
    auth.transporter = installed.transporter;
    if (auth.transporter !== installed.transporter) throw new TypeError("Google authorization transport could not be restored");
    return null;
  } catch (_) {
    return new SheetsAuthenticationError("Sheets authorization transport cleanup failed");
  }
}

async function authorizeSheetsSession(auth) {
  const controller = new AbortController();
  const installed = installAuthorizationTransport(auth, controller);
  let pending;
  try { pending = auth.authorize(); } catch (_) {
    const cleanupError = restoreAuthorizationTransport(auth, installed);
    throw cleanupError || new SheetsAuthenticationError("Sheets authorization failed");
  }
  let failure = null;
  try {
    await boundedAwait(pending, "authorization", controller);
  } catch (error) {
    if (controller.signal.aborted) failure = new SheetsTimeoutError("Sheets authorization timed out");
    else if (classifyError(error).publicCode === "SHEETS_TIMEOUT") failure = error;
    else failure = new SheetsAuthenticationError("Sheets authorization failed");
  }
  const cleanupError = restoreAuthorizationTransport(auth, installed);
  if (failure) throw failure;
  if (cleanupError) throw cleanupError;
}

function linkAbort(externalSignal, controller) {
  if (!externalSignal) return () => {};
  if (externalSignal.aborted) controller.abort();
  const abort = () => controller.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  return () => externalSignal.removeEventListener("abort", abort);
}

async function readFixedModule(sheets, configuration, externalSignal) {
  let readMethod;
  try { readMethod = sheets.spreadsheets.values.batchGet; } catch (_) {
    throw new MalformedSheetsResponseError("Sheets client read surface is invalid");
  }
  if (typeof readMethod !== "function") throw new MalformedSheetsResponseError("Sheets client read surface is invalid");
  const params = Object.freeze({
    spreadsheetId: configuration.spreadsheetId,
    ranges: Object.freeze([configuration.parsedRange.headerRange, configuration.parsedRange.dataRange]),
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const unlink = linkAbort(externalSignal, controller);
    try {
      let pending;
      try {
        pending = readMethod.call(sheets.spreadsheets.values, params, {
          timeout: DEADLINES_MS.request,
          retry: false,
          signal: controller.signal,
        });
      } catch (error) {
        pending = Promise.reject(error);
      }
      return await boundedAwait(pending, "request", controller);
    } catch (error) {
      lastError = error;
      const status = statusFromError(error);
      if (attempt === 2 || !RETRYABLE_STATUS.includes(status)) throw classifiedRequestError(error);
    } finally {
      unlink();
    }
    await retryDelay(externalSignal);
  }
  throw classifiedRequestError(lastError || new SheetsTimeoutError("Sheets request failed"));
}

function createSheetsAdapter({ safety, env, envProvider, googleFactory } = {}) {
  verifyReadOnlyCapability(safety);
  if (env !== undefined && envProvider !== undefined) throw new SheetsConfigurationError("Sheets environment source is invalid");
  const provideEnvironment = envProvider || (env !== undefined ? () => env : () => process.env);
  if (typeof provideEnvironment !== "function") throw new SheetsConfigurationError("Sheets environment source is invalid");

  async function session(operation) {
    let environment;
    try { environment = provideEnvironment(); } catch (_) { throw new SheetsConfigurationError("Sheets environment access failed"); }
    const raw = readSheetsEnvironment(environment);
    const credentials = parseCredentials(raw.credentialsJson);
    const configuration = buildSheetsConfiguration(raw.modules);
    const { auth, sheets } = constructSheetsSession(credentials, googleFactory);

    async function readModule(moduleConfiguration, signal) {
      const response = await readFixedModule(sheets, moduleConfiguration, signal);
      const validated = validateBatchGetResponse(response, moduleConfiguration);
      const snapshot = annotateSnapshot(moduleConfiguration, validated);
      TRUSTED_SHEETS_SNAPSHOTS.add(snapshot);
      return snapshot;
    }

    if (operation !== OPERATIONS.ALL) {
      await authorizeSheetsSession(auth);
      const moduleConfiguration = configuration.modules.find((candidate) => candidate.key === operation);
      if (!moduleConfiguration) throw new MalformedSheetsResponseError("Unapproved Sheets operation");
      return readModule(moduleConfiguration);
    }

    const controller = new AbortController();
    const workflow = (async () => {
      await authorizeSheetsSession(auth);
      const snapshots = [];
      let cellCount = 0;
      let textLength = 0;
      for (const moduleConfiguration of configuration.modules) {
        const snapshot = await readModule(moduleConfiguration, controller.signal);
        cellCount += snapshot.cellCount;
        textLength += snapshot.textLength;
        if (cellCount > LIMITS.cellsReadAll || textLength > LIMITS.textReadAll) {
          throw new UnexpectedSheetStructureError("Configured Sheets exceed the read-all limit");
        }
        snapshots.push(snapshot);
      }
      const snapshot = deepFreeze({ sourceType: "google-sheets", snapshots, cellCount, textLength });
      TRUSTED_SHEETS_SNAPSHOTS.add(snapshot);
      return snapshot;
    })();
    return boundedAwait(workflow, "readAll", controller);
  }

  function fixedMethod(operation) {
    return function fixedSheetsOperation(...args) {
      const rejection = rejectArguments(args);
      return rejection || session(operation);
    };
  }

  return Object.freeze({
    readCctvSheet: fixedMethod(OPERATIONS.CCTV),
    readCustomerExperienceSheet: fixedMethod(OPERATIONS.CUSTOMER_EXPERIENCE),
    readComplaintsSheet: fixedMethod(OPERATIONS.COMPLAINTS),
    readComplimentaryOrdersSheet: fixedMethod(OPERATIONS.COMPLIMENTARY_ORDERS),
    readAllConfiguredSheets: fixedMethod(OPERATIONS.ALL),
  });
}

module.exports = { createSheetsAdapter, verifyTrustedSheetsSnapshot };
