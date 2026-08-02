"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { parseArguments } = require("../../src/cli/parser");
const { validatePathSyntax } = require("../../src/cli/path-policy");

function usage(error) {
  assert.equal(classifyError(error).publicCode, "USAGE_ERROR");
  assert.equal(classifyError(error).exitCode, 2);
  return true;
}

test("parser accepts only the fixed audit grammar", () => {
  assert.deepEqual({ ...parseArguments(["audit", "--format", "json", "--stdout"]) },
    { kind: "audit", format: "json", destination: "stdout", outputPath: null });
  assert.deepEqual({ ...parseArguments(["audit", "--format", "markdown", "--output", "audit.md"]) },
    { kind: "audit", format: "markdown", destination: "file", outputPath: "audit.md" });
  assert.deepEqual({ ...parseArguments(["audit", "--format", "html", "--output", "audit.html"]) },
    { kind: "audit", format: "html", destination: "file", outputPath: "audit.html" });
  assert.equal(Object.isFrozen(parseArguments(["audit", "--format", "json", "--stdout"])), true);
});

test("parser preserves exact legacy commands and audit help", () => {
  for (const [args, kind] of [[["--help"], "help"], [["--version"], "version"], [["preflight"], "preflight"],
    [["audit", "--help"], "audit-help"]]) assert.equal(parseArguments(args).kind, kind);
});

test("missing, duplicate, reordered, conflicting, defaulted, forced, and extra arguments fail", () => {
  const invalid = [
    [], ["audit"], ["audit", "--format"], ["audit", "--format", "json"],
    ["audit", "--stdout"], ["audit", "--stdout", "--format", "json"],
    ["audit", "--format", "JSON", "--stdout"], ["audit", "--format", "json", "--output"],
    ["audit", "--format", "json", "--output", ""], ["audit", "--format", "json", "--output", "--force"],
    ["audit", "--format", "json", "--stdout", "--force"],
    ["audit", "--format", "json", "--stdout", "--output", "audit.json"],
    ["audit", "--format", "json", "--stdout", "extra"], ["audit", "--format", "yaml", "--stdout"],
    ["audit", "--format", "json", "--output", "audit.json"],
    ["audit", "--format", "markdown", "--stdout"], ["audit", "--format", "html", "--stdout"],
    ["audit", "--format", "json", "--stdout", "--database-url", "secret"],
  ];
  for (const args of invalid) assert.throws(() => parseArguments(args), usage, args.join(" "));
});

test("POSIX path syntax accepts exact local files and rejects traversal, controls, and extension mismatch", () => {
  assert.equal(validatePathSyntax("reports/audit.json", "json", "linux").expectedExtension, ".json");
  assert.equal(validatePathSyntax("/var/tmp/audit.md", "markdown", "linux").platform, "posix");
  for (const value of ["", " ", "./audit.json", "../audit.json", "a/../audit.json", "audit.JSON",
    "audit.json\n", "audit\u202e.json", "\ud800.json", "/"]) {
    assert.throws(() => validatePathSyntax(value, "json", "linux"));
  }
});

test("Windows path syntax rejects UNC, device, drive-relative, ADS, reserved names, and trailing dots or spaces", () => {
  assert.equal(validatePathSyntax("C:\\reports\\audit.json", "json", "win32").platform, "win32");
  assert.equal(validatePathSyntax("reports\\audit.md", "markdown", "win32").expectedExtension, ".md");
  for (const value of ["\\\\server\\share\\audit.json", "\\\\?\\C:\\audit.json", "C:audit.json",
    "C:\\reports\\audit.json:stream", "C:\\reports\\CON.json", "C:\\reports\\LPT1.json",
    "C:\\reports\\audit.json ", "C:\\reports\\folder.\\audit.json", "C:\\reports\\audit.JSON"]) {
    assert.throws(() => validatePathSyntax(value, "json", "win32"), undefined, value);
  }
});
