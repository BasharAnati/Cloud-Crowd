#!/usr/bin/env node

"use strict";

const { run } = require("../src/cli");
const { version } = require("../../../../package.json");

const exitCode = run({
  args: process.argv.slice(2),
  env: process.env,
  version,
  stdout: process.stdout,
  stderr: process.stderr,
});

process.exitCode = exitCode;
