"use strict";

const { CliInternalError } = require("../errors");
const { verifyTrustedOutputArtifact } = require("../output/artifact");
const { produceAuditArtifact } = require("./adapter");
const { writeArtifactAtomically } = require("./atomic-write");
const { prepareOutputPath } = require("./path-policy");
const { writeArtifactToStdout } = require("./stdout");

async function executeAuditCommand(command, stdout) {
  let preparedPath = null;
  if (command.destination === "file") preparedPath = await prepareOutputPath(command.outputPath, command.format);
  else if (command.destination !== "stdout") throw new CliInternalError("Audit destination is invalid");

  const artifact = await produceAuditArtifact(command.format);
  let trusted;
  try { trusted = verifyTrustedOutputArtifact(artifact); } catch (_) {
    throw new CliInternalError("Audit renderer returned an untrusted artifact");
  }
  if (command.destination === "stdout") await writeArtifactToStdout(stdout, trusted);
  else await writeArtifactAtomically(trusted, preparedPath);
}

Object.freeze(executeAuditCommand);

module.exports = Object.freeze({ executeAuditCommand });
