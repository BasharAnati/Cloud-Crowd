"use strict";

const { compareCanonicalParityBundle } = require("../../src/parity");
const { EXPECTED_HEADERS } = require("../../src/sheets/structure");
const { bundle, bundleWithSheetOptions, postgresTicket, sheetRow } = require("../parity/helpers");

async function parityResult(postgres = [], sheets = {}) {
  return compareCanonicalParityBundle(await bundle(postgres, sheets));
}

async function zeroFindingResult() {
  const identities = { cctv: "C", "customer-experience": "E", complaints: "P", "complimentary-orders": "F" };
  const postgres = [
    postgresTicket(1, "cctv", "C", { branch: "", dateTime: "", cameras: [], sections: [], staff: [], reviewType: "", violations: [], notes: "", actionTaken: "" }),
    postgresTicket(2, "ce", "E", { department: "", customerName: "", phone: "", creationDate: "", shift: "", orderType: "", branch: "", restaurant: "", channel: "", feedbackDate: "", issueCategory: "", customerNotes: "", actionTaken: "", satisfaction: "" }),
    postgresTicket(3, "complaints", "P", { department: "", customerName: "", phone: "", creationDate: "", shift: "", orderType: "", branch: "", restaurant: "", channel: "", issueCategory: "", complaintDetails: "", actionTaken: "" }),
    postgresTicket(4, "free-orders", "F", { customerName: "", phone: "", orderDate: "", discountAmount: "", reasonForDiscount: "", decisionMaker: "", discountDate: "", newOrderNumber: "", deductionFrom: "", caseDescription: "", actionTaken: "" }),
  ];
  const headers = {
    cctv: [...EXPECTED_HEADERS.cctv.slice(0, 11), "PDF Name", "PDF URL"],
    "customer-experience": [...EXPECTED_HEADERS["customer-experience"]],
    complaints: [...EXPECTED_HEADERS.complaints],
    "complimentary-orders": [...EXPECTED_HEADERS["complimentary-orders"]],
  };
  const options = Object.fromEntries(Object.entries(headers).map(([module, header]) => [module, {
    header, rows: [sheetRow(module, identities[module])],
  }]));
  return compareCanonicalParityBundle(await bundleWithSheetOptions(postgres, options));
}

module.exports = { parityResult, postgresTicket, sheetRow, zeroFindingResult };
