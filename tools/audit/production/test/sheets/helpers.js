"use strict";

const { generateKeyPairSync } = require("node:crypto");
const { enforceSafety } = require("../../src/safety-kernel");
const { EXPECTED_HEADERS } = require("../../src/sheets/structure");

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
const PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function credentialDocument(overrides = {}) {
  return {
    type: "service_account",
    project_id: "audit-test-project",
    private_key_id: "0123456789abcdef0123456789abcdef01234567",
    private_key: PRIVATE_KEY,
    client_email: "audit-reader@audit-test-project.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token",
    ...overrides,
  };
}

function sheetsEnvironment(overrides = {}) {
  return {
    GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify(credentialDocument()),
    GOOGLE_SHEET_ID_CCTV: "cctv_sheet_id_1234567890",
    GOOGLE_SHEET_RANGE_CCTV: "'CCTV'!A2:M",
    GOOGLE_SHEET_ID_CUSTOMER_EXPERIENCE: "customer_sheet_id_123456",
    GOOGLE_SHEET_RANGE_CUSTOMER_EXPERIENCE: "'Customer Experience'!A2:P",
    GOOGLE_SHEET_ID_DAILY_COMPLAINTS: "complaints_sheet_id_12345",
    GOOGLE_SHEET_RANGE_DAILY_COMPLAINTS: "'Daily Complaints'!A2:N",
    GOOGLE_SHEET_ID_COMPLIMENTARY: "complimentary_sheet_12345",
    GOOGLE_SHEET_RANGE_COMPLIMENTARY: "'Complimentary'!A2:M",
    ...overrides,
  };
}

function safeCapability() {
  return enforceSafety({ target: "production", mode: "read-only", productionAcknowledged: true });
}

function responseFor(params, options = {}) {
  const key = params.ranges[0].includes("CCTV") ? "cctv" :
    params.ranges[0].includes("Customer Experience") ? "customer-experience" :
      params.ranges[0].includes("Daily Complaints") ? "complaints" : "complimentary-orders";
  const header = options.header || (key === "cctv"
    ? [...EXPECTED_HEADERS.cctv.slice(0, 11), "Created By", "Created At"]
    : [...EXPECTED_HEADERS[key]]);
  const rows = options.rows || [];
  return {
    data: {
      spreadsheetId: params.spreadsheetId,
      valueRanges: [
        { range: params.ranges[0], majorDimension: "ROWS", values: options.missingHeaderValues ? undefined : [header] },
        { range: params.ranges[1], majorDimension: "ROWS", values: rows },
      ].map((range) => {
        if (range.values === undefined) delete range.values;
        return range;
      }),
    },
  };
}

function fakeGoogle(options = {}) {
  const state = {
    jwtConfigurations: [],
    sheetsConfigurations: [],
    authorizationRequests: [],
    authorizationCancellations: 0,
    authorizationTransporters: [],
    authClients: [],
    authorizations: 0,
    requests: [],
    active: 0,
    maximumActive: 0,
  };
  class AuthorizationTransport {
    request(requestOptions) {
      state.authorizationRequests.push(requestOptions);
      if (options.authorizePending) {
        return new Promise((resolve, reject) => {
          const aborted = () => {
            state.authorizationCancellations += 1;
            reject(new Error("synthetic authorization aborted"));
          };
          if (requestOptions.signal?.aborted) aborted();
          else requestOptions.signal?.addEventListener("abort", aborted, { once: true });
        });
      }
      if (options.authorizeError) return Promise.reject(options.authorizeError);
      return Promise.resolve({ data: { access_token: "synthetic" } });
    }
  }
  class JWT {
    constructor(configuration) {
      state.jwtConfigurations.push(configuration);
      this.transporter = new AuthorizationTransport();
      state.authorizationTransporters.push(this.transporter);
      state.authClients.push(this);
    }
    authorize() {
      state.authorizations += 1;
      return this.transporter.request({ method: "POST" });
    }
  }
  const values = {
    async batchGet(params, requestOptions) {
      state.requests.push({ params, requestOptions });
      state.active += 1;
      state.maximumActive = Math.max(state.maximumActive, state.active);
      try {
        if (options.onBatchGet) {
          const answer = await options.onBatchGet(params, requestOptions, state);
          if (answer !== undefined) return answer;
        }
        return responseFor(params, options.responseOptions || {});
      } finally {
        state.active -= 1;
      }
    },
  };
  for (const method of ["append", "update", "batchUpdate", "clear"]) {
    Object.defineProperty(values, method, { get() { throw new Error(`write method accessed: ${method}`); } });
  }
  const google = {
    auth: { JWT },
    sheets(configuration) {
      state.sheetsConfigurations.push(configuration);
      return { spreadsheets: { values } };
    },
  };
  return { factory: () => google, state };
}

module.exports = { PRIVATE_KEY, credentialDocument, fakeGoogle, responseFor, safeCapability, sheetsEnvironment };
