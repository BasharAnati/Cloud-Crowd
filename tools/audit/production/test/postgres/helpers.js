"use strict";

const { enforceSafety } = require("../../src/safety-kernel");

function safeCapability() {
  return enforceSafety({ target: "production", mode: "read-only", productionAcknowledged: true });
}

function safeRoleRow(overrides = {}) {
  return {
    database_name: "cloud_crowd",
    role_name: "audit_reader",
    is_superuser: false,
    can_create_database: false,
    can_create_role: false,
    can_replicate: false,
    can_bypass_rls: false,
    owns_database: false,
    owns_non_system_schema: false,
    owns_non_system_relation: false,
    owns_non_system_function: false,
    has_database_connect: true,
    has_database_create: false,
    has_database_temporary: false,
    has_unexpected_database_privilege: false,
    has_schema_usage: true,
    has_unexpected_schema_privilege: false,
    has_tickets_select: true,
    has_history_select: true,
    has_unexpected_relation_privilege: false,
    has_role_membership: false,
    has_sequence_privilege: false,
    has_unexpected_function_execute: false,
    ...overrides,
  };
}

function safeRlsRows() {
  return ["ticket_history", "tickets"].map((table_name) => ({
    table_name,
    rls_enabled: false,
    rls_forced: false,
    policy_name: null,
    is_permissive: null,
    command: null,
    using_expression: null,
    role_names: [],
  }));
}

function fakeClientClass(options = {}) {
  class FakeClient {
    static instances = [];
    constructor(configuration) {
      this.configuration = configuration;
      this.calls = [];
      this.endCalls = 0;
      FakeClient.instances.push(this);
      if (options.constructError) throw options.constructError;
    }
    async connect() {
      this.calls.push({ method: "connect" });
      if (options.connectPending) return new Promise(() => {});
      if (options.connectError) throw options.connectError;
    }
    async query(query) {
      this.calls.push({ method: "query", ...query });
      if (options.onQuery) {
        const answer = await options.onQuery(query, this);
        if (answer !== undefined) return answer;
      }
      if (query.text.includes("FROM pg_catalog.pg_roles")) return { rows: [safeRoleRow(options.roleOverrides)] };
      if (query.text.includes("JOIN pg_catalog.pg_policy")) return { rows: options.rlsRows || safeRlsRows() };
      if (query.text === "SHOW transaction_read_only") return { rows: [{ transaction_read_only: "on" }] };
      return { rows: [] };
    }
    async end() {
      this.endCalls += 1;
      this.calls.push({ method: "end" });
      if (options.endPending) return new Promise(() => {});
      if (options.endError) throw options.endError;
    }
  }
  return FakeClient;
}

const adapterEnvironment = Object.freeze({
  AUDIT_DATABASE_URL_UNPOOLED: "postgres://synthetic-secret@invalid/audit",
  AUDIT_DATABASE_ROLE: "audit_reader",
});

module.exports = { adapterEnvironment, fakeClientClass, safeCapability, safeRlsRows, safeRoleRow };
