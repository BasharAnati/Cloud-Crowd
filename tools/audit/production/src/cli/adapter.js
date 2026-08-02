"use strict";

const { runAudit } = require("../orchestrator");
const { renderAuditOutput } = require("../output");
const { verifyTrustedOutputArtifact } = require("../output/artifact");

async function produceAuditArtifact(format) {
  const result = await runAudit();
  const artifact = renderAuditOutput(result, format);
  return verifyTrustedOutputArtifact(artifact);
}

Object.freeze(produceAuditArtifact);

module.exports = Object.freeze({ produceAuditArtifact });
