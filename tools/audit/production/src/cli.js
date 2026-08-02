"use strict";

const { loadEnvironment } = require("./environment");
const {
  CliInternalError,
  EXIT_CODES,
  classifyError,
} = require("./errors");
const { enforceSafety } = require("./safety-kernel");
const { executeAuditCommand } = require("./cli/audit-command");
const { HELP } = require("./cli/help");
const { parseArguments } = require("./cli/parser");
const {
  writeHelpToStdout,
  writePreflightToStdout,
  writePublicErrorToStderr,
  writeVersionToStdout,
} = require("./cli/stdout");

async function execute(command, env, version, stdout) {
  if (command.kind === "help") return writeHelpToStdout(stdout, "global");
  if (command.kind === "audit-help") return writeHelpToStdout(stdout, "audit");
  if (command.kind === "version") return writeVersionToStdout(stdout, version);
  if (command.kind === "preflight") {
    const configuration = enforceSafety(loadEnvironment(env));
    return writePreflightToStdout(stdout, configuration);
  }
  if (command.kind === "audit") return executeAuditCommand(command, stdout);
  throw new CliInternalError("Parsed CLI command is invalid");
}

async function run({ args, env, version, stdout, stderr }) {
  let auditCommand = false;
  try {
    const command = parseArguments(args);
    auditCommand = command.kind === "audit";
    await execute(command, env, version, stdout);
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    let publicError = error;
    let classification = classifyError(publicError);
    if (auditCommand && classification.publicCode === "INTERNAL_ERROR") {
      publicError = new CliInternalError("Audit command failed");
      classification = classifyError(publicError);
    }
    try {
      await writePublicErrorToStderr(stderr, publicError);
    } catch (_) {
      // The primary classification remains authoritative when stderr is unavailable.
    }
    return classification.exitCode;
  }
}

Object.freeze(run);

module.exports = Object.freeze({ HELP, run });
