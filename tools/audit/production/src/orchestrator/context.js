"use strict";

const { loadEnvironment } = require("../environment");
const { enforceSafety } = require("../safety-kernel");
const { createSourceAdapters } = require("./adapter");

function createExecutionContext() {
  const safety = enforceSafety(loadEnvironment());
  const sources = createSourceAdapters(safety);
  return Object.freeze(Object.assign(Object.create(null), { safety, sources }));
}

module.exports = Object.freeze({ createExecutionContext });
