"use strict";

const { UsageError } = require("../errors");

const FORMATS = Object.freeze(["json", "markdown", "html"]);

function command(entries) {
  return Object.freeze(Object.assign(Object.create(null), entries));
}

function usage() {
  throw new UsageError("Unknown command or arguments");
}

function parseArguments(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some((value) => typeof value !== "string")) usage();
  if (args.length === 1 && args[0] === "--help") return command({ kind: "help" });
  if (args.length === 1 && args[0] === "--version") return command({ kind: "version" });
  if (args.length === 1 && args[0] === "preflight") return command({ kind: "preflight" });
  if (args.length === 2 && args[0] === "audit" && args[1] === "--help") return command({ kind: "audit-help" });
  if (args.length === 4 && args[0] === "audit" && args[1] === "--format" &&
      args[2] === "json" && args[3] === "--stdout") {
    return command({ kind: "audit", format: args[2], destination: "stdout", outputPath: null });
  }
  if (args.length === 5 && args[0] === "audit" && args[1] === "--format" &&
      (args[2] === "markdown" || args[2] === "html") && args[3] === "--output" &&
      args[4] !== "" && !args[4].startsWith("--")) {
    return command({ kind: "audit", format: args[2], destination: "file", outputPath: args[4] });
  }
  usage();
}

Object.freeze(parseArguments);

module.exports = Object.freeze({ FORMATS, parseArguments });
