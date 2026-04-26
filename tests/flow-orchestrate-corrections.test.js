'use strict';

/**
 * Characterization tests for autoCorrectCode (Story 14 / wf-d0937c83).
 *
 * Strategy: tests pin the OBSERVED behavior of autoCorrectCode BEFORE the
 * extraction. Same tests run unchanged after the extraction; if they pass,
 * the refactor preserved behavior. This is the spec's required co-land
 * approach (Architect 2026-04-22).
 *
 * Public contract:
 *   autoCorrectCode(code, filePath?, projectConfig?) → { corrected, corrections }
 *
 * Behavioral sections (per source, numbered 1–7):
 *   1. Forbidden imports (default, combined, namespace forms)
 *   2. shadcn component path mapping
 *   3. Feature-folder type path normalization
 *   4. noExternalUtils → @/lib/utils removal + formatCurrency inline + cn() unwrap
 *   5. Double-quote → single-quote normalization (when single quotes dominate)
 *   6. Empty import-statement cleanup
 *   7. Triple+ blank line collapse
 *
 * Run: node --test tests/flow-orchestrate-corrections.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { autoCorrectCode } = require('../scripts/flow-orchestrate');

const REACT_CFG = {
  projectContext: {
    doNotImport: ['React'],
    componentPaths: { Button: '@/widgets/Button', Card: '@/widgets/Card' },
    typePaths: { features: '../api/types' },
    noExternalUtils: false
  }
};

describe('autoCorrectCode — section 1: forbidden imports', () => {
  it('removes default React import (Case A)', () => {
    const r = autoCorrectCode("import React from 'react';\nconst x = 1;", 'a.tsx', REACT_CFG);
    assert.equal(r.corrected.includes('import React'), false);
    assert.ok(r.corrections.some(c => /Removed forbidden import/.test(c)));
  });

  it('strips React from combined import (Case B)', () => {
    const r = autoCorrectCode(
      "import React, { useState, useEffect } from 'react';\n",
      'a.tsx', REACT_CFG
    );
    assert.match(r.corrected, /import\s*\{\s*useState,\s*useEffect\s*\}\s*from\s*['"]react['"]/);
    assert.ok(r.corrections.some(c => /combined import/.test(c)));
  });

  it('removes namespace React import (Case C)', () => {
    const r = autoCorrectCode("import * as React from 'react';\nconst x = 1;", 'a.tsx', REACT_CFG);
    assert.equal(r.corrected.includes('import * as React'), false);
    assert.ok(r.corrections.some(c => /namespace import/.test(c)));
  });

  it('leaves non-forbidden imports alone', () => {
    const r = autoCorrectCode("import { useState } from 'react';\n", 'a.tsx', REACT_CFG);
    assert.match(r.corrected, /import\s*\{\s*useState\s*\}\s*from\s*['"]react['"]/);
  });
});

describe('autoCorrectCode — section 2: shadcn component path mapping', () => {
  it('rewrites shadcn @/components/ui/<X> to mapped path when configured', () => {
    const r = autoCorrectCode("import { Button } from '@/components/ui/button';\n", 'a.tsx', REACT_CFG);
    assert.match(r.corrected, /from\s+'@\/widgets\/Button'/);
    assert.ok(r.corrections.some(c => /Fixed import:/.test(c)));
  });

  it('leaves shadcn paths unchanged when no mapping exists', () => {
    const cfg = { projectContext: { componentPaths: {} } };
    const code = "import { Button } from '@/components/ui/button';\n";
    const r = autoCorrectCode(code, 'a.tsx', cfg);
    assert.match(r.corrected, /@\/components\/ui\/button/);
  });
});

describe('autoCorrectCode — section 3: feature folder type paths', () => {
  it('rewrites ../types and ./types in /features/ files', () => {
    const code = "import { Foo } from '../types';\n";
    const r = autoCorrectCode(code, 'src/features/x.ts', REACT_CFG);
    assert.match(r.corrected, /from\s+'\.\.\/api\/types'/);
    assert.ok(r.corrections.some(c => /type import path/.test(c)));
  });

  it('does NOT rewrite types when filePath is outside /features/', () => {
    const code = "import { Foo } from '../types';\n";
    const r = autoCorrectCode(code, 'src/components/x.ts', REACT_CFG);
    assert.match(r.corrected, /from\s+'\.\.\/types'/);
  });
});

describe('autoCorrectCode — section 4: noExternalUtils', () => {
  const NO_UTILS = {
    projectContext: { ...REACT_CFG.projectContext, noExternalUtils: true }
  };

  it('removes @/lib/utils import and inlines formatCurrency when other imports remain', () => {
    // Characterization: the current code inserts the inlined fn AFTER the
    // last remaining import. If @/lib/utils is the ONLY import, there's no
    // anchor, so nothing is inlined (still removes the import).
    const code = [
      "import { something } from 'mod-x';",
      "import { cn, formatCurrency } from '@/lib/utils';",
      "const x = formatCurrency(10);"
    ].join('\n');
    const r = autoCorrectCode(code, 'a.tsx', NO_UTILS);
    assert.equal(r.corrected.includes('@/lib/utils'), false);
    assert.match(r.corrected, /Intl\.NumberFormat/);
    assert.ok(r.corrections.some(c => /formatCurrency/.test(c)));
  });

  it('removes @/lib/utils import (sole import) — no anchor for inlining', () => {
    const code = [
      "import { cn, formatCurrency } from '@/lib/utils';",
      "const x = formatCurrency(10);"
    ].join('\n');
    const r = autoCorrectCode(code, 'a.tsx', NO_UTILS);
    assert.equal(r.corrected.includes('@/lib/utils'), false);
    // No anchor → nothing inlined; formatCurrency reference remains undefined.
    assert.equal(r.corrected.includes('Intl.NumberFormat'), false);
  });

  it('unwraps cn(`literal`) when noExternalUtils is set', () => {
    const code = [
      "import { cn } from '@/lib/utils';",
      "const c = cn(`flex gap-2`);"
    ].join('\n');
    const r = autoCorrectCode(code, 'a.tsx', NO_UTILS);
    assert.equal(r.corrected.includes('@/lib/utils'), false);
    // cn() unwrap should leave the bare template literal/string
    assert.match(r.corrected, /const c = `flex gap-2`/);
  });
});

describe('autoCorrectCode — section 5: quote normalization', () => {
  it('normalizes double-quote imports when single quotes dominate', () => {
    const code = [
      "import { a } from 'mod-a';",
      "import { b } from 'mod-b';",
      'import { c } from "mod-c";'
    ].join('\n');
    const r = autoCorrectCode(code, 'a.ts', REACT_CFG);
    assert.match(r.corrected, /from\s+'mod-c'/);
  });

  it('does NOT normalize when there are no double-quoted imports', () => {
    const code = "import { a } from 'mod-a';\n";
    const r = autoCorrectCode(code, 'a.ts', REACT_CFG);
    assert.equal(r.corrections.some(c => /Normalized import quotes/.test(c)), false);
  });
});

describe('autoCorrectCode — section 6: empty import cleanup', () => {
  it('removes leftover `import {} from "..."` statements', () => {
    // Generated when section 1 strips the only named import
    const cfg = { projectContext: { doNotImport: ['Foo'] } };
    const code = "import { Foo } from 'mod';\nconst x = 1;";
    const r = autoCorrectCode(code, 'a.ts', cfg);
    // Foo is only-named-import; section 1 strips React-ish forms but here Foo
    // is a named import — section 1 leaves it alone. Verify section 6 alone
    // by feeding an explicit empty import.
    const code2 = "import {} from 'mod';\nconst x = 1;";
    const r2 = autoCorrectCode(code2, 'a.ts', cfg);
    assert.equal(r2.corrected.includes('import {} from'), false);
    void r;
  });
});

describe('autoCorrectCode — section 7: blank-line collapse', () => {
  it('collapses 3+ consecutive blank lines to 2', () => {
    const code = 'const x = 1;\n\n\n\nconst y = 2;\n';
    const r = autoCorrectCode(code, 'a.ts', REACT_CFG);
    assert.equal(r.corrected.match(/\n{3,}/g), null);
  });
});

describe('autoCorrectCode — input validation', () => {
  it('returns input unchanged when code is null', () => {
    const r = autoCorrectCode(null, 'a.ts', REACT_CFG);
    assert.equal(r.corrected, null);
    assert.deepEqual(r.corrections, []);
  });

  it('returns input unchanged when code is non-string', () => {
    const r = autoCorrectCode(42, 'a.ts', REACT_CFG);
    assert.equal(r.corrected, 42);
    assert.deepEqual(r.corrections, []);
  });
});
