"use strict";

const { runAuditPipeline } = require("./pipeline");

async function runAudit() {
  if (arguments.length !== 0) {
    const { OrchestrationError } = require("../errors");
    throw new OrchestrationError("runAudit takes no arguments");
  }
  return runAuditPipeline();
}

Object.freeze(runAudit);

module.exports = Object.freeze({ runAudit });
