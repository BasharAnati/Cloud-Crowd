"use strict";

const fs = require("node:fs");
const path = require("node:path");

function splitTopLevel(source, delimiter) {
  const parts = [];
  let buffer = "";
  let parentheses = 0;
  let brackets = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      buffer += character;
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
      continue;
    }
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (character === "[") brackets += 1;
    if (character === "]") brackets -= 1;
    if (character === delimiter && parentheses === 0 && brackets === 0) {
      parts.push(buffer.trim());
      buffer = "";
    } else {
      buffer += character;
    }
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function findClosingBrace(source, openIndex) {
  let depth = 1;
  let quote = "";
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  throw new Error("Unclosed CSS block");
}

function mediaMatches(query, viewportWidth) {
  if (/prefers-reduced-motion/i.test(query)) return false;
  const max = query.match(/max-width\s*:\s*([0-9.]+)px/i);
  const min = query.match(/min-width\s*:\s*([0-9.]+)px/i);
  if (max && viewportWidth > Number(max[1])) return false;
  if (min && viewportWidth < Number(min[1])) return false;
  return true;
}

function parseDeclarations(body) {
  return splitTopLevel(body, ";").map((entry) => {
    const colon = entry.indexOf(":");
    if (colon < 1) return null;
    const property = entry.slice(0, colon).trim().toLowerCase();
    let value = entry.slice(colon + 1).trim();
    const important = /\s*!important\s*$/i.test(value);
    value = value.replace(/\s*!important\s*$/i, "").trim();
    return { property, value, important };
  }).filter(Boolean);
}

function parseInlineDeclarations(target, page) {
  const source = String(target.inlineStyle || "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (!source.trim()) return [];
  return splitTopLevel(source, ";").map((entry, index) => {
    if (!entry.trim()) return null;
    const colon = entry.indexOf(":");
    if (colon < 1) throw new Error(`${page}: unsupported inline declaration ${entry.trim()}`);
    const property = entry.slice(0, colon).trim().toLowerCase();
    if (!/^(?:--)?[a-z][a-z0-9-]*$/i.test(property)) {
      throw new Error(`${page}: unsupported inline property ${property}`);
    }
    let value = entry.slice(colon + 1).trim();
    if (!value) throw new Error(`${page}: empty inline declaration ${property}`);
    const important = /\s*!important\s*$/i.test(value);
    value = value.replace(/\s*!important\s*$/i, "").trim();
    return { property, value, important, inlineOrder: index };
  }).filter(Boolean);
}

function parseCss(source, sourceName, sourceIndex, viewportWidth, orderState) {
  const rules = [];
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");

  function walk(fragment) {
    let cursor = 0;
    while (cursor < fragment.length) {
      while (/\s/.test(fragment[cursor] || "")) cursor += 1;
      if (cursor >= fragment.length) break;
      const open = fragment.indexOf("{", cursor);
      if (open < 0) break;
      const prelude = fragment.slice(cursor, open).trim();
      const close = findClosingBrace(fragment, open);
      const body = fragment.slice(open + 1, close);
      cursor = close + 1;

      if (/^@media\b/i.test(prelude)) {
        if (mediaMatches(prelude.replace(/^@media\s*/i, ""), viewportWidth)) walk(body);
        continue;
      }
      if (/^@(keyframes|-webkit-keyframes|font-face|supports|page|property)\b/i.test(prelude)) continue;
      if (prelude.startsWith("@")) throw new Error(`Unsupported at-rule in ${sourceName}: ${prelude}`);

      const declarations = parseDeclarations(body).map((declaration) => ({
        ...declaration,
        order: orderState.value++
      }));
      if (!declarations.length) continue;
      splitTopLevel(prelude, ",").forEach((selector) => {
        rules.push({ selector, declarations, sourceName, sourceIndex });
      });
    }
  }

  walk(clean);
  return rules;
}

function extractPageSources(root, page, extraSources = []) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  const sources = [];
  let embeddedIndex = 0;
  const assetPattern = /<link\b[^>]*rel=["']stylesheet["'][^>]*>|<style\b[^>]*>[\s\S]*?<\/style>/gi;
  for (const match of html.matchAll(assetPattern)) {
    if (/^<link/i.test(match[0])) {
      const href = match[0].match(/href=["']([^"']+)["']/i);
      if (!href) throw new Error(`${page}: stylesheet link has no href`);
      const relativePath = href[1].split(/[?#]/)[0];
      const absolutePath = path.join(root, relativePath.replace(/\//g, path.sep));
      if (!fs.existsSync(absolutePath)) throw new Error(`${page}: missing stylesheet ${relativePath}`);
      sources.push({ name: relativePath, css: fs.readFileSync(absolutePath, "utf8"), kind: "linked" });
    } else {
      embeddedIndex += 1;
      const content = match[0].match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
      sources.push({ name: `${page}#style-${embeddedIndex}`, css: content[1], kind: "embedded" });
    }
  }

  extraSources.forEach((extra) => {
    const item = { name: extra.name, css: extra.css, kind: "synthetic" };
    if (extra.after) {
      const position = sources.findIndex((source) => source.name === extra.after);
      if (position < 0) throw new Error(`${page}: cannot insert ${extra.name} after ${extra.after}`);
      sources.splice(position + 1, 0, item);
    } else {
      sources.push(item);
    }
  });
  return sources;
}

function element(tag, options = {}, parent = null) {
  return {
    tag: tag.toLowerCase(),
    id: options.id || "",
    classes: new Set(options.classes || []),
    attributes: { ...(options.attributes || {}) },
    states: new Set(options.states || []),
    pseudoElement: options.pseudoElement || "",
    inlineStyle: options.inlineStyle || "",
    parent
  };
}

function splitComplexSelector(selector) {
  const tokens = [];
  let buffer = "";
  let parentheses = 0;
  let brackets = 0;
  let quote = "";

  function flush() {
    if (buffer.trim()) tokens.push(buffer.trim());
    buffer = "";
  }

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      buffer += character;
      if (character === quote && selector[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
      continue;
    }
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (character === "[") brackets += 1;
    if (character === "]") brackets -= 1;
    if (parentheses === 0 && brackets === 0 && (character === "+" || character === "~")) {
      throw new Error(`Unsupported selector combinator in ${selector}`);
    }
    if (parentheses === 0 && brackets === 0 && character === ">") {
      flush();
      if (tokens[tokens.length - 1] === " ") tokens.pop();
      tokens.push(">");
      continue;
    }
    if (parentheses === 0 && brackets === 0 && /\s/.test(character)) {
      flush();
      if (tokens.length && tokens[tokens.length - 1] !== ">" && tokens[tokens.length - 1] !== " ") tokens.push(" ");
      continue;
    }
    buffer += character;
  }
  flush();
  if (tokens[tokens.length - 1] === " ") tokens.pop();
  return tokens;
}

function extractFunctional(compound, name) {
  const marker = `:${name}(`;
  const start = compound.indexOf(marker);
  if (start < 0) return null;
  let depth = 1;
  for (let index = start + marker.length; index < compound.length; index += 1) {
    if (compound[index] === "(") depth += 1;
    if (compound[index] === ")" && --depth === 0) {
      return {
        before: compound.slice(0, start),
        content: compound.slice(start + marker.length, index),
        after: compound.slice(index + 1)
      };
    }
  }
  throw new Error(`Unclosed :${name}() in ${compound}`);
}

function matchesCompound(target, original) {
  let compound = original;
  let unsupported = "";
  for (const name of ["is", "where", "not", "has"]) {
    let functional;
    while ((functional = extractFunctional(compound, name))) {
      if (name === "has") {
        unsupported = `Unsupported applicable selector :has() in ${original}`;
        compound = functional.before + functional.after;
        continue;
      }
      const matches = splitTopLevel(functional.content, ",").some((part) => matchesSelector(target, part));
      if ((name === "not" && matches) || (name !== "not" && !matches)) return false;
      compound = functional.before + functional.after;
    }
  }

  const pseudoElements = [...compound.matchAll(/::([a-z0-9_-]+)/gi)].map((match) => match[1].toLowerCase());
  if (pseudoElements.length > 1) throw new Error(`Multiple pseudo-elements in ${original}`);
  if ((pseudoElements[0] || "") !== target.pseudoElement) return false;
  compound = compound.replace(/::[a-z0-9_-]+/gi, "");

  let attributeMismatch = false;
  compound = compound.replace(/\[([^\]]+)\]/g, (_match, expression) => {
    const parsed = expression.trim().match(/^([a-z0-9_-]+)(?:\s*(=|\*=|\^=|\$=|~=|\|=)\s*["']?([^"']*)["']?)?$/i);
    if (!parsed) throw new Error(`Unsupported attribute selector [${expression}]`);
    const [, name, operator, expected = ""] = parsed;
    const present = Object.prototype.hasOwnProperty.call(target.attributes, name);
    const actual = present ? String(target.attributes[name]) : "";
    if (!operator) attributeMismatch ||= !present;
    else if (operator === "=") attributeMismatch ||= actual !== expected;
    else if (operator === "*=") attributeMismatch ||= !actual.includes(expected);
    else if (operator === "^=") attributeMismatch ||= !actual.startsWith(expected);
    else if (operator === "$=") attributeMismatch ||= !actual.endsWith(expected);
    else if (operator === "~=") attributeMismatch ||= !actual.split(/\s+/).includes(expected);
    else if (operator === "|=") attributeMismatch ||= actual !== expected && !actual.startsWith(`${expected}-`);
    return "";
  });
  if (attributeMismatch) return false;

  let pseudoMismatch = false;
  compound = compound.replace(/:([a-z0-9_-]+)(?:\(([^)]*)\))?/gi, (_match, name) => {
    const normalized = name.toLowerCase();
    if (normalized === "root") pseudoMismatch ||= target.tag !== "html" || Boolean(target.parent);
    else if (["hover", "focus", "focus-visible", "active", "disabled", "checked", "open"].includes(normalized)) {
      pseudoMismatch ||= !target.states.has(normalized);
    } else if (["first-child", "last-child", "only-child", "nth-child", "nth-of-type"].includes(normalized)) {
      pseudoMismatch = true;
    } else {
      unsupported = `Unsupported applicable pseudo-class :${name} in ${original}`;
    }
    return "";
  });
  if (pseudoMismatch) return false;

  const ids = [...compound.matchAll(/#([a-z0-9_-]+)/gi)].map((match) => match[1]);
  if (ids.some((id) => target.id !== id)) return false;
  const classes = [...compound.matchAll(/\.([a-z0-9_-]+)/gi)].map((match) => match[1]);
  if (classes.some((className) => !target.classes.has(className))) return false;
  const type = compound.replace(/#[a-z0-9_-]+|\.[a-z0-9_-]+|\*/gi, "").trim();
  if (type && type.toLowerCase() !== target.tag) return false;
  if (unsupported) throw new Error(unsupported);
  return true;
}

function matchesSelector(target, selector) {
  const tokens = splitComplexSelector(selector.trim());
  if (!tokens.length) return false;

  function matchAt(elementToMatch, index) {
    if (!elementToMatch || !matchesCompound(elementToMatch, tokens[index])) return false;
    if (index === 0) return true;
    const combinator = tokens[index - 1];
    const nextIndex = index - 2;
    if (combinator === ">") return matchAt(elementToMatch.parent, nextIndex);
    if (combinator !== " ") throw new Error(`Malformed selector ${selector}`);
    for (let ancestor = elementToMatch.parent; ancestor; ancestor = ancestor.parent) {
      if (matchAt(ancestor, nextIndex)) return true;
    }
    return false;
  }

  return matchAt(target, tokens.length - 1);
}

function addSpecificity(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function compareSpecificity(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function specificity(selector) {
  let source = selector;
  let score = [0, 0, 0];
  for (const name of ["where", "is", "not", "has"]) {
    let functional;
    while ((functional = extractFunctional(source, name))) {
      if (name !== "where") {
        const alternatives = splitTopLevel(functional.content, ",").map(specificity);
        alternatives.sort((a, b) => compareSpecificity(b, a));
        score = addSpecificity(score, alternatives[0]);
      }
      source = functional.before + functional.after;
    }
  }
  score[0] += (source.match(/#[a-z0-9_-]+/gi) || []).length;
  score[1] += (source.match(/\.[a-z0-9_-]+|\[[^\]]+\]|:(?!:)[a-z0-9_-]+(?:\([^)]*\))?/gi) || []).length;
  score[2] += (source.match(/::[a-z0-9_-]+/gi) || []).length;
  const types = source
    .replace(/#[a-z0-9_-]+|\.[a-z0-9_-]+|\[[^\]]+\]|::?[a-z0-9_-]+(?:\([^)]*\))?/gi, " ")
    .replace(/[>+~,*]/g, " ")
    .match(/\b[a-z][a-z0-9-]*\b/gi) || [];
  score[2] += types.length;
  return score;
}

function splitWhitespaceTopLevel(source) {
  const parts = [];
  let buffer = "";
  let parentheses = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      buffer += character;
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
      continue;
    }
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (/\s/.test(character) && parentheses === 0) {
      if (buffer) parts.push(buffer);
      buffer = "";
    } else {
      buffer += character;
    }
  }
  if (buffer) parts.push(buffer);
  return parts;
}

function boxSideValue(value, side) {
  const values = splitWhitespaceTopLevel(value);
  if (!values.length || values.length > 4) return null;
  const [top, right = top, bottom = top, left = right] = values.length === 3
    ? [values[0], values[1], values[2], values[1]]
    : values.length === 2
      ? [values[0], values[1], values[0], values[1]]
      : values;
  return { top, right, bottom, left }[side];
}

function axisSideValue(value, side) {
  const values = splitWhitespaceTopLevel(value);
  if (!values.length || values.length > 2) return null;
  return side === "start" ? values[0] : values[1] || values[0];
}

function declarationValueForProperty(declaration, property) {
  if (declaration.property === property) return declaration.value;
  if (["background", "background-color"].includes(property) &&
      ["background", "background-color"].includes(declaration.property)) return declaration.value;
  if (property === "border-color" && declaration.property === "border") return declaration.value;
  if (property === "border-bottom-color") {
    return ["border-bottom", "border-color", "border"].includes(declaration.property) ? declaration.value : null;
  }

  const logicalToPhysical = {
    "padding-inline-start": "padding-left",
    "padding-inline-end": "padding-right",
    "padding-block-start": "padding-top",
    "padding-block-end": "padding-bottom",
    "margin-inline-start": "margin-left",
    "margin-inline-end": "margin-right",
    "margin-block-start": "margin-top",
    "margin-block-end": "margin-bottom"
  };
  const target = logicalToPhysical[property] || property;
  const declared = logicalToPhysical[declaration.property] || declaration.property;
  if (declared === target) return declaration.value;

  const box = target.match(/^(padding|margin)-(top|right|bottom|left)$/);
  if (!box) return null;
  const [, family, side] = box;
  if (declaration.property === family) return boxSideValue(declaration.value, side);
  if (declaration.property === `${family}-inline` && ["left", "right"].includes(side)) {
    return axisSideValue(declaration.value, side === "left" ? "start" : "end");
  }
  if (declaration.property === `${family}-block` && ["top", "bottom"].includes(side)) {
    return axisSideValue(declaration.value, side === "top" ? "start" : "end");
  }
  return null;
}

function declarationAffects(declaration, property) {
  return declarationValueForProperty(declaration, property) !== null;
}

function outranks(candidate, winner) {
  if (!winner) return true;
  if (candidate.important !== winner.important) return candidate.important;
  if (Boolean(candidate.inline) !== Boolean(winner.inline)) return Boolean(candidate.inline);
  const specificityOrder = compareSpecificity(candidate.specificity, winner.specificity);
  if (specificityOrder) return specificityOrder > 0;
  return candidate.order > winner.order;
}

function createCascade(root, page, options = {}) {
  const viewportWidth = options.viewportWidth || 1440;
  const sources = extractPageSources(root, page, options.extraSources || []);
  const orderState = { value: 0 };
  const rules = sources.flatMap((source, sourceIndex) => {
    return parseCss(source.css, source.name, sourceIndex, viewportWidth, orderState);
  });
  const customCache = new WeakMap();

  function winner(target, property) {
    let winning = null;
    for (const rule of rules) {
      if (!rule.declarations.some((declaration) => declarationAffects(declaration, property))) continue;
      let applicable;
      try {
        applicable = matchesSelector(target, rule.selector);
      } catch (error) {
        error.message = `${page}: ${error.message} in ${rule.sourceName}`;
        throw error;
      }
      if (!applicable) continue;
      const selectorSpecificity = specificity(rule.selector);
      for (const declaration of rule.declarations) {
        if (!declarationAffects(declaration, property)) continue;
        const candidate = {
          ...declaration,
          value: declarationValueForProperty(declaration, property),
          selector: rule.selector,
          sourceName: rule.sourceName,
          specificity: selectorSpecificity
        };
        if (outranks(candidate, winning)) winning = candidate;
      }
    }
    for (const declaration of parseInlineDeclarations(target, page)) {
      if (!declarationAffects(declaration, property)) continue;
      const candidate = {
        ...declaration,
        value: declarationValueForProperty(declaration, property),
        selector: "style attribute",
        sourceName: `${page}#inline`,
        inline: true,
        specificity: [1, 0, 0],
        order: orderState.value + declaration.inlineOrder
      };
      if (outranks(candidate, winning)) winning = candidate;
    }
    if (!winning && property === "color" && target.parent) return winner(target.parent, property);
    return winning;
  }

  function customProperties(target) {
    if (customCache.has(target)) return customCache.get(target);
    const inherited = target.parent ? new Map(customProperties(target.parent)) : new Map();
    const winners = new Map();
    for (const rule of rules) {
      const customDeclarations = rule.declarations.filter((declaration) => declaration.property.startsWith("--"));
      if (!customDeclarations.length || !matchesSelector(target, rule.selector)) continue;
      const selectorSpecificity = specificity(rule.selector);
      for (const declaration of customDeclarations) {
        const candidate = { ...declaration, selector: rule.selector, sourceName: rule.sourceName, specificity: selectorSpecificity };
        if (outranks(candidate, winners.get(declaration.property))) winners.set(declaration.property, candidate);
      }
    }
    for (const declaration of parseInlineDeclarations(target, page).filter((item) => item.property.startsWith("--"))) {
      const candidate = {
        ...declaration,
        selector: "style attribute",
        sourceName: `${page}#inline`,
        inline: true,
        specificity: [1, 0, 0],
        order: orderState.value + declaration.inlineOrder
      };
      if (outranks(candidate, winners.get(declaration.property))) winners.set(declaration.property, candidate);
    }
    winners.forEach((declaration, property) => inherited.set(property, declaration.value));
    customCache.set(target, inherited);
    return inherited;
  }

  function resolveValue(target, value, stack = []) {
    let output = value;
    for (let guard = 0; guard < 100 && /var\(/.test(output); guard += 1) {
      output = output.replace(/var\(\s*(--[a-z0-9_-]+)(?:\s*,\s*([^()]*))?\s*\)/gi, (_match, name, fallback) => {
        if (stack.includes(name)) throw new Error(`${page}: recursive semantic token ${[...stack, name].join(" -> ")}`);
        const variables = customProperties(target);
        if (!variables.has(name)) {
          if (fallback === undefined) throw new Error(`${page}: unresolved semantic token ${name}`);
          if (/var\(/.test(fallback)) throw new Error(`${page}: unsupported unresolved fallback for ${name}`);
          return fallback.trim();
        }
        return resolveValue(target, variables.get(name), [...stack, name]);
      });
    }
    if (/var\(/.test(output)) throw new Error(`${page}: unsupported nested var() expression ${output}`);
    return output.trim();
  }

  return { page, viewportWidth, sources, rules, winner, customProperties, resolveValue };
}

function normalizeHex(hex) {
  const value = hex.toLowerCase();
  if (value.length === 4) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  return value.slice(0, 7);
}

function colorFromValue(value) {
  const hexes = [...value.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => normalizeHex(match[0]));
  if (hexes.length) {
    const unique = [...new Set(hexes)];
    if (unique.length !== 1) throw new Error(`Value does not resolve to one color: ${value}`);
    return unique[0];
  }
  const rgb = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) !== 1) throw new Error(`Alpha color needs a backing surface: ${value}`);
    return `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error(`Unsupported effective color ${value}`);
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255).map((value) => {
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function effectiveColor(cascade, target, property) {
  const declaration = cascade.winner(target, property);
  if (!declaration) throw new Error(`${cascade.page}: no winning ${property} declaration`);
  const resolved = cascade.resolveValue(target, declaration.value);
  return { declaration, resolved, color: colorFromValue(resolved) };
}

function winnerDescription(cascade, label, property, result, expected) {
  const actual = result ? `${result.value} from ${result.selector} in ${result.sourceName}` : "no declaration";
  return `${cascade.page} | ${label} | ${property} | winner: ${actual} | expected: ${expected}`;
}

module.exports = {
  colorFromValue,
  compareSpecificity,
  contrastRatio,
  createCascade,
  effectiveColor,
  element,
  extractPageSources,
  matchesSelector,
  specificity,
  winnerDescription
};
