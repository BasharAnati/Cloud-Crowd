"use strict";

const { createPostgresAdapter } = require("../../src/postgres");
const { createSheetsAdapter } = require("../../src/sheets");
const {
  adapterEnvironment,
  fakeClientClass,
  safeCapability: postgresCapability,
} = require("../postgres/helpers");
const {
  fakeGoogle,
  responseFor,
  safeCapability: sheetsCapability,
  sheetsEnvironment,
} = require("../sheets/helpers");

const DEFAULT_TICKET = Object.freeze({
  id: "9007199254740993",
  section: "ce",
  status: " Open ",
  payload: Object.freeze({
    orderNumber: "  ORD-1  ",
    customerName: " Alice\r\nSmith ",
    phone: " 0790000000 ",
    branch: " Amman ",
    creationDate: "2026-07-31T12:30",
    customerNotes: " First line\r\nSecond line  ",
    createdBy: " owner@example.test ",
  }),
  created_at: "2026-07-31 10:00:00+00",
  updated_at: "2026-08-01T10:00:00.000Z",
});

const DEFAULT_HISTORY = Object.freeze({
  id: "22",
  ticket_id: "9007199254740993",
  section: "ce",
  changed_by: " auditor ",
  prev_status: "Open",
  new_status: "Closed",
  prev_action: null,
  new_action: " Completed ",
  changed_at: "2026-08-01T11:00:00.000Z",
});

async function trustedTicketSnapshot(rows = [DEFAULT_TICKET]) {
  const Client = fakeClientClass({
    onQuery(query) {
      if (query.text.includes("FROM public.tickets ORDER BY")) return { rows };
      return undefined;
    },
  });
  const adapter = createPostgresAdapter({
    safety: postgresCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client,
  });
  return adapter.listTicketsPage({ limit: Math.max(1, rows.length) });
}

async function trustedHistorySnapshot(rows = [DEFAULT_HISTORY]) {
  const Client = fakeClientClass({
    onQuery(query) {
      if (query.text.includes("FROM public.ticket_history ORDER BY")) return { rows };
      return undefined;
    },
  });
  const adapter = createPostgresAdapter({
    safety: postgresCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client,
  });
  return adapter.listHistoryPage({ limit: Math.max(1, rows.length) });
}

async function trustedSheetSnapshot(method, rows, header, responseOverrides = {}) {
  const google = fakeGoogle({ responseOptions: { rows, ...(header ? { header } : {}), ...responseOverrides } });
  const adapter = createSheetsAdapter({ safety: sheetsCapability(), env: sheetsEnvironment(), googleFactory: google.factory });
  return adapter[method]();
}

async function trustedAllSheetsSnapshot(rowsByKey = {}) {
  const google = fakeGoogle({
    onBatchGet(params) {
      const key = params.ranges[0].includes("CCTV") ? "cctv" :
        params.ranges[0].includes("Customer Experience") ? "customer-experience" :
          params.ranges[0].includes("Daily Complaints") ? "complaints" : "complimentary-orders";
      return responseFor(params, { rows: rowsByKey[key] || [] });
    },
  });
  const adapter = createSheetsAdapter({ safety: sheetsCapability(), env: sheetsEnvironment(), googleFactory: google.factory });
  return adapter.readAllConfiguredSheets();
}

module.exports = {
  DEFAULT_HISTORY,
  DEFAULT_TICKET,
  trustedAllSheetsSnapshot,
  trustedHistorySnapshot,
  trustedSheetSnapshot,
  trustedTicketSnapshot,
};
