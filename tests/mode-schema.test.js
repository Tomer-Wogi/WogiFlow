'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  loadMode,
  validateMode,
  parseModeYaml,
  listModeFiles,
  VALID_MODE_NAMES,
  MODES_DIR
} = require('../lib/mode-schema');

function tmpModeFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-modes-'));
  fs.writeFileSync(path.join(dir, `${name}.yaml`), content);
  return dir;
}

const MINIMAL_VALID = {
  name: 'coding',
  roleDefinition: 'Implementation phase.',
  whenToUse: 'After spec approval.'
};

describe('validateMode', () => {
  it('accepts a minimal valid mode object', () => {
    assert.equal(validateMode({ ...MINIMAL_VALID }), true);
  });

  it('accepts a fully-populated mode object', () => {
    assert.equal(
      validateMode({
        ...MINIMAL_VALID,
        customInstructions: 'Be careful.',
        allowedToolGroups: ['read', 'edit']
      }),
      true
    );
  });

  it('rejects when a required field is missing', () => {
    const obj = { ...MINIMAL_VALID };
    delete obj.whenToUse;
    assert.throws(() => validateMode(obj), /missing required field "whenToUse"/);
  });

  it('rejects when a required field is the wrong type', () => {
    assert.throws(
      () => validateMode({ ...MINIMAL_VALID, roleDefinition: 42 }),
      /field "roleDefinition" must be a non-empty string/
    );
  });

  it('rejects when allowedToolGroups is not an array', () => {
    assert.throws(
      () => validateMode({ ...MINIMAL_VALID, allowedToolGroups: 'read' }),
      /field "allowedToolGroups" must be an array/
    );
  });

  it('rejects an unknown mode name', () => {
    assert.throws(
      () => validateMode({ ...MINIMAL_VALID, name: 'launching' }),
      /field "name" must be one of/
    );
  });

  it('rejects unknown top-level fields', () => {
    assert.throws(
      () => validateMode({ ...MINIMAL_VALID, extra: 'nope' }),
      /unknown field "extra"/
    );
  });
});

describe('parseModeYaml', () => {
  it('parses scalar, block scalar, and list values', () => {
    const yaml = [
      'name: coding',
      'roleDefinition: |',
      '  line one',
      '  line two',
      'whenToUse: After spec approval.',
      'allowedToolGroups:',
      '  - read',
      '  - edit'
    ].join('\n');

    const result = parseModeYaml(yaml);
    assert.equal(result.name, 'coding');
    assert.equal(result.roleDefinition, 'line one\nline two');
    assert.equal(result.whenToUse, 'After spec approval.');
    assert.deepEqual(result.allowedToolGroups, ['read', 'edit']);
  });

  it('strips matching quotes from scalar values', () => {
    const result = parseModeYaml('name: "coding"\nroleDefinition: \'r\'\nwhenToUse: w');
    assert.equal(result.name, 'coding');
    assert.equal(result.roleDefinition, 'r');
    assert.equal(result.whenToUse, 'w');
  });

  it('throws on duplicate keys', () => {
    assert.throws(
      () => parseModeYaml('name: a\nname: b'),
      /duplicate key "name"/
    );
  });

  it('throws on indented top-level lines', () => {
    assert.throws(
      () => parseModeYaml('  name: coding'),
      /top-level keys must start at column 0/
    );
  });

  it('throws on a missing colon', () => {
    assert.throws(
      () => parseModeYaml('name coding'),
      /expected "key: value"/
    );
  });

  it('refuses prototype-pollution keys', () => {
    assert.throws(
      () => parseModeYaml('__proto__: x'),
      /forbidden key "__proto__"/
    );
  });

  it('returns a null-prototype object', () => {
    const result = parseModeYaml('name: coding');
    assert.equal(Object.getPrototypeOf(result), null);
  });
});

describe('loadMode', () => {
  it('round-trips a valid file', () => {
    const yaml = [
      'name: coding',
      'roleDefinition: r',
      'whenToUse: w',
      'allowedToolGroups:',
      '  - read'
    ].join('\n');
    const dir = tmpModeFile('coding', yaml);
    const result = loadMode('coding', { modesDir: dir });
    assert.equal(result.name, 'coding');
    assert.deepEqual(result.allowedToolGroups, ['read']);
  });

  it('rejects an unknown mode name', () => {
    assert.throws(() => loadMode('launching'), /unknown mode "launching"/);
  });

  it('surfaces a specific field error for a malformed file', () => {
    const yaml = 'name: coding\nroleDefinition: r\n';
    const dir = tmpModeFile('coding', yaml);
    assert.throws(
      () => loadMode('coding', { modesDir: dir }),
      /missing required field "whenToUse"/
    );
  });

  it('reports the file path in parse errors', () => {
    const dir = tmpModeFile('coding', '  name: coding');
    assert.throws(
      () => loadMode('coding', { modesDir: dir }),
      /coding\.yaml: line 1/
    );
  });
});

describe('production mode files', () => {
  it('all 5 files exist on disk', () => {
    for (const name of VALID_MODE_NAMES) {
      const filePath = path.join(MODES_DIR, `${name}.yaml`);
      assert.ok(fs.existsSync(filePath), `missing ${filePath}`);
    }
  });

  it('all 5 files load and validate', () => {
    for (const name of VALID_MODE_NAMES) {
      const mode = loadMode(name);
      assert.equal(mode.name, name, `mode ${name} reports wrong name`);
    }
  });

  it('listModeFiles returns the 5 known modes', () => {
    const found = new Set(listModeFiles());
    for (const name of VALID_MODE_NAMES) {
      assert.ok(found.has(name), `listModeFiles missing ${name}`);
    }
  });
});
