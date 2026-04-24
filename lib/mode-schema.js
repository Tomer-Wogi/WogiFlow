'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MODES_DIR = path.join(process.cwd(), '.workflow', 'modes');

const VALID_MODE_NAMES = new Set([
  'exploring',
  'spec_review',
  'coding',
  'validating',
  'completing'
]);

const REQUIRED_FIELDS = ['name', 'roleDefinition', 'whenToUse'];
const OPTIONAL_FIELDS = ['customInstructions', 'allowedToolGroups'];
const ALL_FIELDS = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function parseModeYaml(content, sourceLabel = '<inline>') {
  const result = Object.create(null);
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      i += 1;
      continue;
    }

    const indent = raw.length - raw.trimStart().length;
    if (indent !== 0) {
      throw new Error(
        `${sourceLabel}: line ${i + 1}: top-level keys must start at column 0 (got indent ${indent})`
      );
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(`${sourceLabel}: line ${i + 1}: expected "key: value" (no colon found)`);
    }

    const key = trimmed.slice(0, colonIdx).trim();
    if (!key) {
      throw new Error(`${sourceLabel}: line ${i + 1}: empty key`);
    }
    if (DANGEROUS_KEYS.has(key)) {
      throw new Error(`${sourceLabel}: line ${i + 1}: forbidden key "${key}"`);
    }
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`${sourceLabel}: line ${i + 1}: duplicate key "${key}"`);
    }

    const valueRaw = trimmed.slice(colonIdx + 1).trim();

    if (valueRaw === '|') {
      const { text, nextIndex } = readBlockScalar(lines, i + 1, sourceLabel);
      result[key] = text;
      i = nextIndex;
      continue;
    }

    if (valueRaw === '') {
      const { items, nextIndex } = readList(lines, i + 1, sourceLabel);
      if (items === null) {
        throw new Error(
          `${sourceLabel}: line ${i + 1}: key "${key}" has no value, scalar block, or list`
        );
      }
      result[key] = items;
      i = nextIndex;
      continue;
    }

    result[key] = unquoteScalar(valueRaw);
    i += 1;
  }

  return result;
}

function readBlockScalar(lines, startIndex, sourceLabel) {
  const collected = [];
  let baseIndent = null;
  let i = startIndex;

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === '') {
      collected.push('');
      i += 1;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) break;
    if (baseIndent === null) baseIndent = indent;
    if (indent < baseIndent) break;
    collected.push(raw.slice(baseIndent));
    i += 1;
  }

  if (baseIndent === null) {
    throw new Error(`${sourceLabel}: line ${startIndex}: block scalar (|) has no indented content`);
  }

  while (collected.length > 0 && collected[collected.length - 1] === '') {
    collected.pop();
  }

  return { text: collected.join('\n'), nextIndex: i };
}

function readList(lines, startIndex, sourceLabel) {
  const items = [];
  let i = startIndex;
  let sawListItem = false;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      i += 1;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) break;
    if (!trimmed.startsWith('- ')) {
      throw new Error(
        `${sourceLabel}: line ${i + 1}: expected list item starting with "- "`
      );
    }
    sawListItem = true;
    const value = trimmed.slice(2).trim();
    if (!value) {
      throw new Error(`${sourceLabel}: line ${i + 1}: empty list item`);
    }
    items.push(unquoteScalar(value));
    i += 1;
  }

  if (!sawListItem) {
    return { items: null, nextIndex: startIndex };
  }
  return { items, nextIndex: i };
}

function unquoteScalar(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function validateMode(obj, sourceLabel = '<object>') {
  if (obj === null || typeof obj !== 'object') {
    throw new Error(`${sourceLabel}: mode must be an object, got ${typeof obj}`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) {
      throw new Error(`${sourceLabel}: missing required field "${field}"`);
    }
    if (typeof obj[field] !== 'string' || obj[field].trim() === '') {
      throw new Error(`${sourceLabel}: field "${field}" must be a non-empty string`);
    }
  }

  if (!VALID_MODE_NAMES.has(obj.name)) {
    throw new Error(
      `${sourceLabel}: field "name" must be one of ${[...VALID_MODE_NAMES].join(', ')} (got "${obj.name}")`
    );
  }

  if (Object.prototype.hasOwnProperty.call(obj, 'customInstructions')) {
    if (typeof obj.customInstructions !== 'string') {
      throw new Error(`${sourceLabel}: field "customInstructions" must be a string`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(obj, 'allowedToolGroups')) {
    const groups = obj.allowedToolGroups;
    if (!Array.isArray(groups)) {
      throw new Error(`${sourceLabel}: field "allowedToolGroups" must be an array`);
    }
    for (let i = 0; i < groups.length; i += 1) {
      if (typeof groups[i] !== 'string' || groups[i].trim() === '') {
        throw new Error(
          `${sourceLabel}: field "allowedToolGroups[${i}]" must be a non-empty string`
        );
      }
    }
  }

  for (const key of Object.keys(obj)) {
    if (!ALL_FIELDS.has(key)) {
      throw new Error(`${sourceLabel}: unknown field "${key}"`);
    }
  }

  return true;
}

function loadMode(name, options = {}) {
  if (typeof name !== 'string' || !name) {
    throw new Error('loadMode: mode name must be a non-empty string');
  }
  if (!VALID_MODE_NAMES.has(name)) {
    throw new Error(
      `loadMode: unknown mode "${name}" (valid: ${[...VALID_MODE_NAMES].join(', ')})`
    );
  }

  const dir = options.modesDir || MODES_DIR;
  const filePath = path.join(dir, `${name}.yaml`);

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`loadMode: failed to read ${filePath}: ${err.message}`);
  }

  const parsed = parseModeYaml(content, filePath);
  validateMode(parsed, filePath);
  return parsed;
}

function listModeFiles(dir = MODES_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''));
}

module.exports = {
  loadMode,
  validateMode,
  parseModeYaml,
  listModeFiles,
  VALID_MODE_NAMES,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  MODES_DIR
};
