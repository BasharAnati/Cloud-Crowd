"use strict";

const {
  assembleCanonicalParityBundle,
  normalizeAll,
  normalizePostgresSnapshot,
  normalizeSheetsSnapshot,
} = require("./adapter");

module.exports = Object.freeze({
  assembleCanonicalParityBundle,
  normalizeAll,
  normalizePostgresSnapshot,
  normalizeSheetsSnapshot,
});
