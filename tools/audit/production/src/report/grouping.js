"use strict";

const { CATEGORIES, CLASSES, FINDING_TYPES, MODULES, typePolicy } = require("./policy");
const { categoryLabel, findingEntry, moduleLabel, nullObject } = require("./model");

function counts(keys) { return Object.fromEntries(keys.map((key) => [key, 0])); }
function frozenCounts(values, keys) { return nullObject(keys.map((key) => [key, values[key]])); }

function createModuleState(module) {
  return {
    module,
    findingCount: 0,
    byCategory: counts(CATEGORIES),
    byType: counts(FINDING_TYPES),
    byClass: counts(CLASSES),
    categories: new Map(CATEGORIES.map((category) => [category, new Map()])),
  };
}

function groupFindings(findings) {
  const modules = new Map(MODULES.map((module) => [module, createModuleState(module)]));
  const globalByCategory = counts(CATEGORIES);
  const globalByType = counts(FINDING_TYPES);
  const globalByClass = counts(CLASSES);
  let groupCount = 0;
  for (const finding of findings) {
    const policy = typePolicy(finding.findingType);
    const state = modules.get(finding.module);
    state.findingCount += 1;
    state.byCategory[policy.category] += 1;
    state.byType[finding.findingType] += 1;
    state.byClass[finding.class] += 1;
    globalByCategory[policy.category] += 1;
    globalByType[finding.findingType] += 1;
    globalByClass[finding.class] += 1;
    const category = state.categories.get(policy.category);
    let group = category.get(finding.findingType);
    if (!group) {
      group = [];
      category.set(finding.findingType, group);
      groupCount += 1;
    }
    group.push(findingEntry(finding));
  }
  const moduleSections = Object.freeze(MODULES.map((module) => {
    const state = modules.get(module);
    const categorySections = Object.freeze(CATEGORIES.map((category) => {
      const groups = state.categories.get(category);
      const findingGroups = Object.freeze(FINDING_TYPES.filter((type) => typePolicy(type).category === category && groups.has(type)).map((type) => {
        const policy = typePolicy(type);
        const entries = Object.freeze(groups.get(type));
        return nullObject([
          ["findingType", type], ["label", policy.label], ["descriptionCode", policy.descriptionCode],
          ["description", policy.description], ["findingCount", entries.length], ["entries", entries],
        ]);
      }));
      return nullObject([
        ["category", category], ["label", categoryLabel(category)], ["findingCount", state.byCategory[category]],
        ["findingGroups", findingGroups],
      ]);
    }));
    return nullObject([
      ["module", module], ["label", moduleLabel(module)], ["findingCount", state.findingCount],
      ["findingsByCategory", frozenCounts(state.byCategory, CATEGORIES)],
      ["findingsByType", frozenCounts(state.byType, FINDING_TYPES)],
      ["findingsByClass", frozenCounts(state.byClass, CLASSES)],
      ["categorySections", categorySections],
    ]);
  }));
  return Object.freeze({
    groupCount,
    moduleSections,
    findingsByCategory: frozenCounts(globalByCategory, CATEGORIES),
    findingsByType: frozenCounts(globalByType, FINDING_TYPES),
    findingsByClass: frozenCounts(globalByClass, CLASSES),
  });
}

module.exports = Object.freeze({ groupFindings });
