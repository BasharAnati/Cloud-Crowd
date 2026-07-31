"use strict";

const { loadEnvironment } = require("./environment");
const {
  EXIT_CODES,
  UsageError,
  classifyError,
} = require("./errors");
const { enforceSafety } = require("./safety-kernel");

const HELP = `Cloud Crowd Production Audit Tool

Usage:
  npm run audit:production -- --help
  npm run audit:production -- --version
  npm run audit:production -- preflight

Commands:
  preflight   Validate the production read-only safety configuration

Options:
  --help      Show this help
  --version   Show the tool version
`;

function write(stream, message) {
  stream.write(`${message}\n`);
}

function execute(args, env, version, stdout) {
  if (args.length === 0) {
    throw new UsageError("A command or option is required");
  }

  if (args.length === 1 && args[0] === "--help") {
    stdout.write(HELP);
    return;
  }

  if (args.length === 1 && args[0] === "--version") {
    write(stdout, version);
    return;
  }

  if (args.length === 1 && args[0] === "preflight") {
    const configuration = enforceSafety(loadEnvironment(env));
    write(stdout, "Production audit preflight passed");
    write(stdout, `Target: ${configuration.target}`);
    write(stdout, `Mode: ${configuration.mode}`);
    write(stdout, "Writes allowed: false");
    return;
  }

  throw new UsageError(`Unknown command or arguments`);
}

function run({ args, env, version, stdout, stderr }) {
  try {
    execute(args, env, version, stdout);
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const classification = classifyError(error);
    write(
      stderr,
      `ERROR [${classification.publicCode}]: ${classification.publicMessage}`
    );
    return classification.exitCode;
  }
}

module.exports = {
  HELP,
  run,
};
