"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { run } = require("../src/cli");
const { ConfigurationError, EXIT_CODES } = require("../src/errors");

function capture() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    value() { return value; },
  };
}

function invoke(args, env = {}) {
  const stdout = capture();
  const stderr = capture();
  const exitCode = run({
    args,
    env,
    version: "1.2.3",
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { exitCode, stdout: stdout.value(), stderr: stderr.value() };
}

const validEnvironment = Object.freeze({
  AUDIT_TARGET: "production",
  AUDIT_MODE: "read-only",
  AUDIT_PRODUCTION_ACKNOWLEDGED: "true",
});

test("help succeeds without loading the environment", () => {
  const result = invoke(["--help"]);
  assert.equal(result.exitCode, EXIT_CODES.SUCCESS);
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stderr, "");
});

test("version prints the supplied package version", () => {
  const result = invoke(["--version"]);
  assert.equal(result.exitCode, EXIT_CODES.SUCCESS);
  assert.equal(result.stdout, "1.2.3\n");
});

test("preflight succeeds for the explicit read-only production environment", () => {
  const result = invoke(["preflight"], validEnvironment);
  assert.equal(result.exitCode, EXIT_CODES.SUCCESS);
  assert.match(result.stdout, /Production audit preflight passed/);
  assert.match(result.stdout, /Writes allowed: false/);
});

test("preflight fails when environment is missing", () => {
  const result = invoke(["preflight"]);
  assert.equal(result.exitCode, EXIT_CODES.CONFIGURATION_ERROR);
  assert.match(result.stderr, /CONFIGURATION_ERROR/);
});

test("unknown commands fail with a usage exit code", () => {
  const result = invoke(["audit"]);
  assert.equal(result.exitCode, EXIT_CODES.USAGE_ERROR);
  assert.match(result.stderr, /USAGE_ERROR/);
});

test("unknown flags fail with a usage exit code", () => {
  const result = invoke(["--unknown"]);
  assert.equal(result.exitCode, EXIT_CODES.USAGE_ERROR);
});

test("duplicate commands fail with a usage exit code", () => {
  const result = invoke(["preflight", "preflight"], validEnvironment);
  assert.equal(result.exitCode, EXIT_CODES.USAGE_ERROR);
});

test("conflicting arguments fail with a usage exit code", () => {
  const result = invoke(["preflight", "--help"], validEnvironment);
  assert.equal(result.exitCode, EXIT_CODES.USAGE_ERROR);
});

test("malformed arguments fail with a usage exit code", () => {
  const result = invoke(["--"]);
  assert.equal(result.exitCode, EXIT_CODES.USAGE_ERROR);
});

test("no command does not trigger default execution", () => {
  const result = invoke([]);
  assert.equal(result.exitCode, EXIT_CODES.USAGE_ERROR);
});

test("output does not expose unrelated secrets or rejected values", () => {
  const secret = "postgres://user:password@example.invalid/database";
  const result = invoke(["preflight"], {
    ...validEnvironment,
    AUDIT_MODE: secret,
    DATABASE_URL: secret,
    GOOGLE_APPLICATION_CREDENTIALS_JSON: secret,
  });
  assert.equal(result.exitCode, EXIT_CODES.SAFETY_VIOLATION);
  assert.doesNotMatch(result.stdout + result.stderr, /postgres:\/\//);
  assert.doesNotMatch(result.stdout + result.stderr, /password/);
});

test("AUDIT_ALLOW_WRITES=true is rejected", () => {
  const result = invoke(["preflight"], {
    ...validEnvironment,
    AUDIT_ALLOW_WRITES: "true",
  });
  assert.equal(result.exitCode, EXIT_CODES.SAFETY_VIOLATION);
});

test("typed error messages are redacted at the CLI boundary", () => {
  const secrets = [
    "postgres://user:password@example.invalid/database",
    "SYNTHETIC_API_TOKEN",
    "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_KEY\n-----END PRIVATE KEY-----",
    '{"client_email":"audit@example.invalid","private_key":"SYNTHETIC"}',
  ];
  const embeddedMessage = `Configuration failed: ${secrets.join(" | ")}`;
  const env = new Proxy(
    {},
    {
      get() {
        throw new ConfigurationError(embeddedMessage);
      },
    }
  );

  const result = invoke(["preflight"], env);
  assert.equal(result.exitCode, EXIT_CODES.CONFIGURATION_ERROR);
  for (const secret of secrets) {
    assert.equal(result.stderr.includes(secret), false);
  }
  assert.match(result.stderr, /Invalid production audit configuration/);
});

function invokeWithTypedError(mutateError) {
  const error = new ConfigurationError("SYNTHETIC_SECRET_MESSAGE");
  mutateError(error);
  const env = new Proxy(
    {},
    {
      get() {
        throw error;
      },
    }
  );
  return invoke(["preflight"], env);
}

test("mutated error.code cannot inject public output", () => {
  const secret = "postgres://synthetic:password@example.invalid/database";
  const result = invokeWithTypedError((error) => {
    error.code = secret;
  });

  assert.equal(result.exitCode, EXIT_CODES.CONFIGURATION_ERROR);
  assert.equal(
    result.stderr,
    "ERROR [CONFIGURATION_ERROR]: Invalid production audit configuration\n"
  );
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.includes(secret), false);
});

test("mutated error.exitCode cannot override the fixed exit code", () => {
  const result = invokeWithTypedError((error) => {
    error.exitCode = EXIT_CODES.SUCCESS;
  });

  assert.equal(result.exitCode, EXIT_CODES.CONFIGURATION_ERROR);
  assert.notEqual(result.exitCode, EXIT_CODES.SUCCESS);
});

test("throwing error.code getter is never evaluated", () => {
  const result = invokeWithTypedError((error) => {
    Object.defineProperty(error, "code", {
      get() {
        throw new Error("SYNTHETIC_SECRET_CODE_GETTER");
      },
    });
  });

  assert.equal(result.exitCode, EXIT_CODES.CONFIGURATION_ERROR);
  assert.equal(result.stderr.includes("SYNTHETIC_SECRET_CODE_GETTER"), false);
});

test("throwing error.exitCode getter is never evaluated", () => {
  const result = invokeWithTypedError((error) => {
    Object.defineProperty(error, "exitCode", {
      get() {
        throw new Error("SYNTHETIC_SECRET_EXIT_GETTER");
      },
    });
  });

  assert.equal(result.exitCode, EXIT_CODES.CONFIGURATION_ERROR);
  assert.equal(result.stderr.includes("SYNTHETIC_SECRET_EXIT_GETTER"), false);
});
