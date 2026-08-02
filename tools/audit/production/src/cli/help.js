"use strict";

const HELP = `Cloud Crowd Production Audit Tool

Usage:
  npm run audit:production -- --help
  npm run audit:production -- --version
  npm run audit:production -- preflight
  npm run audit:production -- audit --format json --stdout
  npm run audit:production -- audit --format markdown --output <file>
  npm run audit:production -- audit --format html --output <file>

Commands:
  preflight   Validate the production read-only safety configuration
  audit       Run the production audit and emit one fixed output format

Options:
  --help      Show this help
  --version   Show the tool version
`;

const AUDIT_HELP = `Cloud Crowd Production Audit Tool

Usage:
  npm run audit:production -- audit --format json --stdout
  npm run audit:production -- audit --format markdown --output <file>
  npm run audit:production -- audit --format html --output <file>

Formats:
  json
  markdown
  html

Destinations:
  --stdout        Write only the rendered artifact to stdout
  --output <file> Atomically create a new file

File output:
  The parent directory must already exist.
  Existing destinations are never overwritten.
  The destination directory and its ancestors must be controlled by a trusted operator and must not be replaced during execution.
`;

module.exports = Object.freeze({ AUDIT_HELP, HELP });
