#!/usr/bin/env node

/**
 * Wogi Flow - Export Scanner
 *
 * Scans TypeScript/JavaScript files for exports to build an accurate
 * import map for the local LLM. This ensures the LLM only uses imports
 * that actually exist in the project.
 *
 * Usage:
 *   node flow-export-scanner.js [project-root]
 *   node flow-export-scanner.js --cache  # Use cached export map if fresh
 *
 * When used as a module, call setProjectRoot() before other functions.
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot: getProjectRootFromUtils, getConfig } = require('./flow-utils');

// Default to getProjectRoot from utils, can be overridden via setProjectRoot() or CLI arg
let PROJECT_ROOT = getProjectRootFromUtils();
let CONFIG_PATH = path.join(PROJECT_ROOT, '.workflow/config.json');
let CACHE_PATH = path.join(PROJECT_ROOT, '.workflow/state/export-map.json');
const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Set the project root directory.
 * Must be called before using any other functions when used as a module.
 * @param {string} root - Absolute path to project root
 */
function setProjectRoot(root) {
  PROJECT_ROOT = path.resolve(root);
  CONFIG_PATH = path.join(PROJECT_ROOT, '.workflow/config.json');
  CACHE_PATH = path.join(PROJECT_ROOT, '.workflow/state/export-map.json');
}

/**
 * Get current project root
 * @returns {string}
 */
function getProjectRoot() {
  return PROJECT_ROOT;
}

// Alias getConfig as loadConfig for minimal code changes
const loadConfig = getConfig;

// ============================================================
// Export Extraction
// ============================================================

/**
 * Extract exports from a TypeScript/JavaScript file
 * @param {string} filePath - Path to the file
 * @returns {{ namedExports: string[], defaultExport: string|null, types: string[], arrayExports: string[] }}
 */
function extractExports(filePath) {
  const result = {
    namedExports: [],
    defaultExport: null,
    types: [],
    arrayExports: [] // Exports that are arrays (for variant detection)
  };

  if (!fs.existsSync(filePath)) return result;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Match export { X, Y, Z } and export { X as Y }
    const reExportMatches = content.matchAll(/export\s+\{\s*([^}]+)\s*\}/g);
    for (const match of reExportMatches) {
      const exports = match[1].split(',').map(e => {
        const parts = e.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim(); // Use the aliased name if exists
      }).filter(e => e && !e.startsWith('type '));
      result.namedExports.push(...exports);
    }

    // Match export type { X, Y }
    const typeExportMatches = content.matchAll(/export\s+type\s+\{\s*([^}]+)\s*\}/g);
    for (const match of typeExportMatches) {
      const types = match[1].split(',').map(e => e.trim().split(/\s+as\s+/).pop().trim());
      result.types.push(...types);
    }

    // Match export const/function/class X and detect arrays
    const namedExportMatches = content.matchAll(/export\s+(?:const|let|var)\s+(\w+)\s*(?::\s*\w+(?:\[\])?)?\s*=\s*(\[|\{|[^;]+)/g);
    for (const match of namedExportMatches) {
      const exportName = match[1];
      const valueStart = match[2].trim();

      if (!result.namedExports.includes(exportName)) {
        result.namedExports.push(exportName);
      }

      // Detect if this is an array export (common for variants)
      if (valueStart === '[' ||
          exportName.includes('Variants') ||
          exportName.includes('Sizes') ||
          exportName.includes('Statuses') ||
          exportName.includes('Options')) {
        result.arrayExports.push(exportName);
      }
    }

    // Match export function/class
    const funcExportMatches = content.matchAll(/export\s+(?:function|class)\s+(\w+)/g);
    for (const match of funcExportMatches) {
      if (!result.namedExports.includes(match[1])) {
        result.namedExports.push(match[1]);
      }
    }

    // Match export type/interface X
    const typeDefMatches = content.matchAll(/export\s+(?:type|interface)\s+(\w+)/g);
    for (const match of typeDefMatches) {
      if (!result.types.includes(match[1])) {
        result.types.push(match[1]);
      }
    }

    // Match export default X or export default function X
    const defaultMatch = content.match(/export\s+default\s+(?:function\s+)?(\w+)/);
    if (defaultMatch) {
      result.defaultExport = defaultMatch[1];
    }

    // Also check for "export default" at end of file (common pattern)
    const defaultAtEnd = content.match(/export\s+default\s+(\w+)\s*;?\s*$/m);
    if (defaultAtEnd && !result.defaultExport) {
      result.defaultExport = defaultAtEnd[1];
    }

  } catch (err) {
    // Ignore read errors
  }

  return result;
}

/**
 * Extract props interface and type aliases from a component file
 * @param {string} filePath - Path to the component file
 * @returns {{ props: Object, typeAliases: Object, usageExample: Object|null, enums: Object, genericTypes: Object }}
 */
function extractComponentDetails(filePath) {
  const result = {
    props: {},
    typeAliases: {},
    usageExample: null,
    enums: {},
    genericTypes: {}
  };

  if (!fs.existsSync(filePath)) return result;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract enums (e.g., enum Status { Active = 'active', Inactive = 'inactive' })
    const enumMatches = content.matchAll(/enum\s+(\w+)\s*\{([^}]+)\}/g);
    for (const match of enumMatches) {
      const enumName = match[1];
      const enumBody = match[2];

      // Extract enum values
      const valueMatches = enumBody.matchAll(/(\w+)\s*=\s*['"]([^'"]+)['"]/g);
      const values = [];
      for (const vm of valueMatches) {
        values.push(vm[2]);
      }

      // Also handle simple enums without explicit values
      if (values.length === 0) {
        const simpleValues = enumBody.match(/\b(\w+)\b(?=\s*[,}])/g);
        if (simpleValues) {
          values.push(...simpleValues.filter(v => v !== 'const'));
        }
      }

      if (values.length > 0) {
        result.enums[enumName] = values;
        result.typeAliases[enumName] = values; // Also expose as type alias
      }
    }

    // Extract type aliases - handle multiple patterns
    // Pattern 1: type X = 'a' | 'b' | 'c' (string literal union)
    const stringUnionMatches = content.matchAll(/type\s+(\w+)\s*=\s*(['"][^'"]+['"](?:\s*\|\s*['"][^'"]+['"])*)/g);
    for (const match of stringUnionMatches) {
      const typeName = match[1];
      const typeValue = match[2];
      const literalMatches = typeValue.match(/['"]([^'"]+)['"]/g);
      if (literalMatches) {
        result.typeAliases[typeName] = literalMatches.map(v => v.replace(/['"]/g, ''));
      }
    }

    // Pattern 2: type X = number | string | boolean (primitive union)
    const primitiveUnionMatches = content.matchAll(/type\s+(\w+)\s*=\s*((?:string|number|boolean|null|undefined)(?:\s*\|\s*(?:string|number|boolean|null|undefined))*)/g);
    for (const match of primitiveUnionMatches) {
      result.typeAliases[match[1]] = [match[2]]; // Store as single value representing the union
    }

    // Pattern 3: type X = typeof Y[number] (indexed access types)
    const indexedAccessMatches = content.matchAll(/type\s+(\w+)\s*=\s*typeof\s+(\w+)\[(?:number|'[^']+')?\]/g);
    for (const match of indexedAccessMatches) {
      const typeName = match[1];
      const sourceArray = match[2];
      // Link to the array type alias if we found it
      if (result.typeAliases[`_array_${sourceArray}`]) {
        result.typeAliases[typeName] = result.typeAliases[`_array_${sourceArray}`];
      }
    }

    // Pattern 4: type X<T> = ... (generic type definitions)
    const genericTypeMatches = content.matchAll(/type\s+(\w+)<([^>]+)>\s*=\s*([^;\n]+)/g);
    for (const match of genericTypeMatches) {
      result.genericTypes[match[1]] = {
        params: match[2].split(',').map(p => p.trim()),
        definition: match[3].trim()
      };
    }

    // Pattern 5: type Props = { ... } (object type alias - treat like interface)
    const typeObjectMatches = content.matchAll(/type\s+(\w+Props)\s*=\s*\{/g);
    for (const match of typeObjectMatches) {
      const typeName = match[1];
      const startIndex = match.index + match[0].length;

      let braceCount = 1;
      let endIndex = startIndex;
      while (braceCount > 0 && endIndex < content.length) {
        if (content[endIndex] === '{') braceCount++;
        if (content[endIndex] === '}') braceCount--;
        endIndex++;
      }

      const propsBody = content.slice(startIndex, endIndex - 1);
      extractPropsFromBody(propsBody, result.props);
    }

    // Also check for "as const" arrays that define variants
    // e.g., const buttonVariants = ['primary', 'secondary'] as const
    const constArrayMatches = content.matchAll(/(?:export\s+)?const\s+(\w+)\s*=\s*\[([^\]]+)\]\s*(?:as\s+const)?/g);
    for (const match of constArrayMatches) {
      const constName = match[1];
      const arrayContent = match[2];

      const literalMatches = arrayContent.match(/['"]([^'"]+)['"]/g);
      if (literalMatches) {
        const values = literalMatches.map(v => v.replace(/['"]/g, ''));
        // Store as a pseudo-type for reference
        result.typeAliases[`_array_${constName}`] = values;
      }
    }

    // Extract props interfaces - handle nested braces with balanced matching
    // Match: interface XxxProps { ... } or interface XxxProps extends YYY { ... }
    const propsInterfaceRegex = /interface\s+(\w+Props)\s*(?:<[^>]+>)?\s*(?:extends[^{]+)?\{/g;
    let propsMatch;
    while ((propsMatch = propsInterfaceRegex.exec(content)) !== null) {
      const startIndex = propsMatch.index + propsMatch[0].length;

      // Find matching closing brace with balanced brace counting
      let braceCount = 1;
      let endIndex = startIndex;
      while (braceCount > 0 && endIndex < content.length) {
        if (content[endIndex] === '{') braceCount++;
        if (content[endIndex] === '}') braceCount--;
        endIndex++;
      }

      const propsBody = content.slice(startIndex, endIndex - 1);
      extractPropsFromBody(propsBody, result.props);
    }

    // Extract React.FC<Props> or FC<Props> style component definitions
    const fcPropsMatches = content.matchAll(/(?:React\.)?FC<(\w+)>/g);
    for (const match of fcPropsMatches) {
      const propsTypeName = match[1];
      // Mark that this type is used as component props
      result.typeAliases[`_fcProps_${propsTypeName}`] = propsTypeName;
    }

  } catch (err) {
    // Ignore read errors
  }

  return result;
}

/**
 * Extract props from an interface/type body
 * @param {string} propsBody - The body content between braces
 * @param {Object} propsTarget - Target object to store extracted props
 */
function extractPropsFromBody(propsBody, propsTarget) {
  // Parse each prop line - handle multi-line types
  const lines = propsBody.split('\n');
  let currentProp = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    currentProp += ' ' + trimmed;

    // Check if we have a complete property (ends with ; or has balanced brackets)
    const hasComplete = trimmed.endsWith(';') ||
                        (currentProp.split('{').length === currentProp.split('}').length &&
                         currentProp.split('<').length === currentProp.split('>').length);

    if (hasComplete && currentProp.includes(':')) {
      // Parse the accumulated property
      const propMatch = currentProp.match(/^\s*(\w+)(\?)?:\s*(.+?)(?:;|$)/);
      if (propMatch) {
        const propName = propMatch[1];
        const isOptional = !!propMatch[2];
        let propType = propMatch[3].trim();

        // Skip internal props (starting with $ or _)
        if (!propName.startsWith('$') && !propName.startsWith('_')) {
          // Clean up type (remove comments, trailing semicolons)
          propType = propType.replace(/\/\*.*?\*\//g, '').replace(/;$/, '').trim();

          propsTarget[propName] = {
            type: propType,
            optional: isOptional
          };
        }
      }
      currentProp = '';
    }
  }
}

/**
 * Generate a usage example for a component
 * @param {string} componentName - Name of the component
 * @param {Object} props - Extracted props
 * @param {Object} typeAliases - Type aliases for string literal unions
 * @returns {{ jsx: string, propsInfo: string[] }}
 */
function generateUsageExample(componentName, props, typeAliases) {
  let example = `<${componentName}`;
  const propsInfo = [];

  // Important props to show in examples
  const importantProps = ['variant', 'size', 'type', 'status', 'color', 'kind'];

  for (const propName of importantProps) {
    if (props[propName]) {
      const propType = props[propName].type;

      // Look up the type in our aliases
      let values = typeAliases[propType];

      // Also check for array-based variants
      if (!values) {
        // Try to find matching array (e.g., variant -> buttonVariants)
        for (const [aliasName, aliasValues] of Object.entries(typeAliases)) {
          if (aliasName.startsWith('_array_') &&
              aliasName.toLowerCase().includes(propName.toLowerCase())) {
            values = aliasValues;
            break;
          }
        }
      }

      if (values && values.length > 0) {
        const defaultValue = values[0];
        example += ` ${propName}="${defaultValue}"`;
        propsInfo.push(`${propName}="${values.join('" | "')}"`);
      }
    }
  }

  example += `>{children}</${componentName}>`;

  return {
    jsx: example,
    propsInfo
  };
}

/**
 * Scan a component/module directory for exports and resolve import path
 * @param {string} dirPath - Full path to the component directory
 * @param {string} baseImportPath - Base import path (e.g., '@/components')
 * @param {boolean} includeDetails - Whether to extract props and usage examples
 * @returns {{ exports: string[], types: string[], importPath: string, defaultExport: string|null, arrayExports: string[], props: Object, usageExample: Object|null }|null}
 */
function scanModuleExports(dirPath, baseImportPath, includeDetails = false) {
  const dirName = path.basename(dirPath);

  // Check for index file first
  const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  let mainFile = null;
  let componentFile = null;

  for (const indexFile of indexFiles) {
    const indexPath = path.join(dirPath, indexFile);
    if (fs.existsSync(indexPath)) {
      mainFile = indexPath;
      break;
    }
  }

  // Also find the main component file for props extraction
  const componentFiles = [`${dirName}.tsx`, `${dirName}.ts`, `${dirName}.jsx`, `${dirName}.js`];
  for (const compFile of componentFiles) {
    const compPath = path.join(dirPath, compFile);
    if (fs.existsSync(compPath)) {
      componentFile = compPath;
      if (!mainFile) mainFile = compPath;
      break;
    }
  }

  if (!mainFile) return null;

  const result = extractExports(mainFile);

  const moduleResult = {
    exports: [...new Set(result.namedExports)],
    types: [...new Set(result.types)],
    defaultExport: result.defaultExport,
    arrayExports: [...new Set(result.arrayExports)],
    importPath: `${baseImportPath}/${dirName}`
  };

  // Extract props and generate usage example if requested
  if (includeDetails && componentFile) {
    const details = extractComponentDetails(componentFile);
    moduleResult.props = details.props;
    moduleResult.typeAliases = details.typeAliases;

    // Generate usage example
    if (Object.keys(details.props).length > 0) {
      moduleResult.usageExample = generateUsageExample(dirName, details.props, details.typeAliases);
    }
  }

  return moduleResult;
}

/**
 * Scan a single file (not a directory) for exports
 * @param {string} filePath - Full path to the file
 * @param {string} baseImportPath - Base import path
 * @returns {{ exports: string[], types: string[], importPath: string, defaultExport: string|null }|null}
 */
function scanFileExports(filePath, baseImportPath) {
  if (!fs.existsSync(filePath)) return null;

  const fileName = path.basename(filePath);
  const fileNameWithoutExt = fileName.replace(/\.(tsx?|jsx?)$/, '');

  const result = extractExports(filePath);

  return {
    exports: [...new Set(result.namedExports)],
    types: [...new Set(result.types)],
    defaultExport: result.defaultExport,
    importPath: `${baseImportPath}/${fileNameWithoutExt}`
  };
}

// ============================================================
// Export Map Building
// ============================================================

/**
 * Build export map for all configured directories
 * @param {object} config - Project config
 * @returns {object} Export map with components, hooks, types, etc.
 */
function buildExportMap(config) {
  const projectContext = config.hybrid?.projectContext || {};
  const exportMap = {
    components: {},
    hooks: {},
    services: {},
    types: {},
    utils: {},
    _meta: {
      generatedAt: new Date().toISOString(),
      projectRoot: PROJECT_ROOT
    }
  };

  // Scan component directories (with details for usage examples)
  const componentDirs = projectContext.componentDirs || ['src/components'];
  for (const dir of componentDirs) {
    const fullDir = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    // Include details (props, usage examples) for components
    scanDirectory(fullDir, '@/components', exportMap.components, true);
  }

  // Scan hooks directory (use config if available, with glob support)
  const hooksDirs = projectContext.hookDirs || ['src/hooks', 'hooks'];
  for (const dir of hooksDirs) {
    // Convert directory path to import path
    // apps/web/src/features/auth/hooks -> @/features/auth/hooks
    // src/hooks -> @/hooks
    const importBase = dir
      .replace(/^apps\/\w+\/src\//, '@/')  // apps/web/src/ -> @/
      .replace(/^src\//, '@/');             // src/ -> @/

    // Handle glob patterns like src/hooks/*.ts
    if (dir.includes('*')) {
      const baseDir = dir.split('*')[0].replace(/\/$/, '');
      const fullDir = path.join(PROJECT_ROOT, baseDir);
      if (!fs.existsSync(fullDir)) continue;

      scanDirectoryFlat(fullDir, importBase.split('*')[0].replace(/\/$/, ''), exportMap.hooks);
    } else {
      const fullDir = path.join(PROJECT_ROOT, dir);
      if (!fs.existsSync(fullDir)) continue;

      // Hooks can be individual files or directories
      scanDirectoryFlat(fullDir, importBase, exportMap.hooks);
    }
  }

  // Scan services directory
  const servicesDirs = ['src/services', 'services', 'src/lib'];
  for (const dir of servicesDirs) {
    const fullDir = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    scanDirectoryFlat(fullDir, dir.startsWith('src/') ? `@/${dir.replace('src/', '')}` : `@/${dir}`, exportMap.services);
  }

  // Scan type directories
  const typeDirs = projectContext.typeDirs || ['src/types'];
  for (const dir of typeDirs) {
    // Handle glob patterns like src/types/*.ts
    if (dir.includes('*')) {
      const baseDir = dir.split('*')[0].replace(/\/$/, '');
      const fullDir = path.join(PROJECT_ROOT, baseDir);
      if (!fs.existsSync(fullDir)) continue;

      scanDirectoryFlat(fullDir, '@/types', exportMap.types, true);
    } else {
      const fullDir = path.join(PROJECT_ROOT, dir);
      if (!fs.existsSync(fullDir)) continue;

      scanDirectoryFlat(fullDir, '@/types', exportMap.types, true);
    }
  }

  // Scan utils directory
  const utilsDirs = ['src/utils', 'src/lib/utils', 'utils'];
  for (const dir of utilsDirs) {
    const fullDir = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    scanDirectoryFlat(fullDir, dir.startsWith('src/') ? `@/${dir.replace('src/', '')}` : `@/${dir}`, exportMap.utils);
  }

  return exportMap;
}

/**
 * Scan a directory containing subdirectories (like src/components/)
 * @param {boolean} includeDetails - Whether to extract props and usage examples
 */
function scanDirectory(dirPath, baseImportPath, target, includeDetails = false) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Skip common excluded directories
      if (['__tests__', '__mocks__', 'node_modules', '.git'].includes(entry.name)) continue;

      const modulePath = path.join(dirPath, entry.name);
      const result = scanModuleExports(modulePath, baseImportPath, includeDetails);

      if (result && (result.exports.length > 0 || result.defaultExport)) {
        target[entry.name] = result;
      }
    }
  } catch (err) {
    // Ignore scan errors
  }
}

/**
 * Scan a directory containing files (like src/hooks/)
 */
function scanDirectoryFlat(dirPath, baseImportPath, target, typesOnly = false) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip test files and common excludes
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
      if (entry.name.includes('.stories.')) continue;
      if (entry.name === 'index.ts' || entry.name === 'index.js') continue;

      const entryPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        const result = scanModuleExports(entryPath, baseImportPath);
        if (result && (result.exports.length > 0 || result.defaultExport || result.types.length > 0)) {
          target[entry.name] = result;
        }
      } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
        const result = scanFileExports(entryPath, baseImportPath);
        if (result) {
          const key = entry.name.replace(/\.(tsx?|jsx?)$/, '');
          if (typesOnly) {
            if (result.types.length > 0) {
              target[key] = result;
            }
          } else if (result.exports.length > 0 || result.defaultExport) {
            target[key] = result;
          }
        }
      }
    }
  } catch (err) {
    // Ignore scan errors
  }
}

// ============================================================
// Caching
// ============================================================

/**
 * Load cached export map if it's fresh
 * @returns {object|null} Cached export map or null
 */
function loadCachedExportMap() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;

    const stat = fs.statSync(CACHE_PATH);
    const age = Date.now() - stat.mtimeMs;

    if (age > CACHE_MAX_AGE_MS) return null;

    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save export map to cache
 * @param {object} exportMap - Export map to cache
 */
function saveExportMapCache(exportMap) {
  try {
    const stateDir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(exportMap, null, 2));
  } catch (err) {
    console.error(`Warning: Could not cache export map: ${err.message}`);
  }
}

/**
 * Clear the export map cache
 */
function clearCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      fs.unlinkSync(CACHE_PATH);
      console.log('✓ Cleared export map cache');
    }
  } catch (err) {
    console.error(`Warning: Could not clear cache: ${err.message}`);
  }
}

// ============================================================
// Formatting for Templates
// ============================================================

/**
 * Format export map as markdown for templates
 * @param {object} exportMap - Export map
 * @returns {string} Markdown-formatted export list
 */
function formatExportMapForTemplate(exportMap) {
  const lines = [];

  // Components
  if (Object.keys(exportMap.components).length > 0) {
    lines.push('#### Components');
    for (const [name, info] of Object.entries(exportMap.components)) {
      const exports = info.exports.join(', ') || (info.defaultExport ? `default: ${info.defaultExport}` : '');
      if (exports) {
        lines.push(`- \`import { ${info.exports.join(', ')} } from '${info.importPath}'\``);
      }
    }
    lines.push('');
  }

  // Hooks
  if (Object.keys(exportMap.hooks).length > 0) {
    lines.push('#### Hooks');
    for (const [name, info] of Object.entries(exportMap.hooks)) {
      const exports = info.exports.join(', ');
      if (exports) {
        lines.push(`- \`import { ${exports} } from '${info.importPath}'\``);
      }
    }
    lines.push('');
  }

  // Services
  if (Object.keys(exportMap.services).length > 0) {
    lines.push('#### Services');
    for (const [name, info] of Object.entries(exportMap.services)) {
      const exports = info.exports.join(', ');
      if (exports) {
        lines.push(`- \`import { ${exports} } from '${info.importPath}'\``);
      }
    }
    lines.push('');
  }

  // Types
  if (Object.keys(exportMap.types).length > 0) {
    lines.push('#### Types');
    for (const [name, info] of Object.entries(exportMap.types)) {
      const types = info.types.join(', ');
      if (types) {
        lines.push(`- \`import type { ${types} } from '${info.importPath}'\``);
      }
    }
    lines.push('');
  }

  // Utils
  if (Object.keys(exportMap.utils).length > 0) {
    lines.push('#### Utilities');
    for (const [name, info] of Object.entries(exportMap.utils)) {
      const exports = info.exports.join(', ');
      if (exports) {
        lines.push(`- \`import { ${exports} } from '${info.importPath}'\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// Component Usage Validation
// ============================================================

/**
 * Validate component usage patterns in generated code
 * @param {string} code - Generated code to validate
 * @param {object} exportMap - Export map with array export info
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateComponentUsage(code, exportMap = null) {
  const errors = [];
  const warnings = [];

  // Load export map if not provided
  if (!exportMap) {
    exportMap = loadCachedExportMap();
    if (!exportMap) {
      return { valid: true, errors: [], warnings: ['No export map available for validation'] };
    }
  }

  // Collect all array exports from components
  const arrayExports = new Set();
  for (const [name, info] of Object.entries(exportMap.components || {})) {
    if (info.arrayExports) {
      info.arrayExports.forEach(e => arrayExports.add(e));
    }
  }

  // Check for array-as-object access patterns
  // e.g., cardVariants.default, buttonVariants.primary
  const arrayAccessPattern = /(\w+(?:Variants|Sizes|Statuses|Options))\.(\w+)/g;
  const matches = code.matchAll(arrayAccessPattern);

  for (const match of matches) {
    const exportName = match[1];
    const accessedProp = match[2];

    // If this is a known array export, it's wrong to access it as an object
    if (arrayExports.has(exportName)) {
      errors.push(
        `Invalid usage: "${match[0]}" - ${exportName} is an ARRAY, not an object. ` +
        `Use string literal: "${accessedProp}" instead of ${exportName}.${accessedProp}`
      );
    } else {
      // Even if not in our export map, warn about common patterns
      warnings.push(
        `Suspicious pattern: "${match[0]}" - ${exportName} is likely an array. ` +
        `Consider using string literal: "${accessedProp}"`
      );
    }
  }

  // Check for variant/size/type props using object access instead of string literals
  // e.g., variant={buttonVariants.primary} instead of variant="primary"
  const propObjectPattern = /(?:variant|size|type|status)=\{(\w+(?:Variants|Sizes|Types|Statuses))\.(\w+)\}/g;
  const propMatches = code.matchAll(propObjectPattern);

  for (const match of propMatches) {
    const exportName = match[1];
    const value = match[2];
    errors.push(
      `Invalid prop usage: "${match[0]}" - Use string literal instead: ` +
      `variant="${value}" (NOT {${exportName}.${value}})`
    );
  }

  // Check for hook file name vs export name mismatches
  // Common pattern: use-auth-store.ts exports useAuthState, not useAuthStore
  const hookPatterns = [
    { pattern: /useAuthStore\(\)/g, suggestion: 'useAuthState()' },
    { pattern: /useUserStore\(\)/g, suggestion: 'useUserState()' },
    { pattern: /useCartStore\(\)/g, suggestion: 'useCartState()' },
  ];

  for (const { pattern, suggestion } of hookPatterns) {
    if (pattern.test(code)) {
      // Check if the actual export exists
      const wrongName = pattern.source.replace(/\\/g, '').replace(/\(\)/g, '');
      let found = false;
      for (const [name, info] of Object.entries(exportMap.hooks || {})) {
        if (info.exports?.includes(wrongName)) {
          found = true;
          break;
        }
      }
      if (!found) {
        warnings.push(
          `Possible hook name mistake: Check if "${wrongName}" is the correct export name. ` +
          `File names often differ from export names (e.g., use-auth-store.ts might export ${suggestion.replace('()', '')})`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Format component with usage example for context
 * @param {string} name - Component name
 * @param {object} info - Component info from export map
 * @returns {string} Formatted markdown
 */
function formatComponentWithUsage(name, info) {
  let output = `#### ${name}\n\n`;
  output += '```typescript\n';
  if (info.exports.length > 0) {
    output += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
  } else if (info.defaultExport) {
    output += `import ${info.defaultExport} from '${info.importPath}';\n`;
  }
  output += '```\n\n';

  // Show props table if available
  if (info.props && Object.keys(info.props).length > 0) {
    output += '**Props:**\n';

    // Important props to show first (styling/behavior related)
    const importantProps = ['variant', 'size', 'padding', 'status', 'type', 'color', 'disabled', 'checked', 'onChange', 'onClick', 'children'];
    const shownProps = new Set();

    // Show important props first
    for (const propName of importantProps) {
      if (info.props[propName]) {
        const propInfo = info.props[propName];
        const optional = propInfo.optional ? '?' : '';
        let typeDisplay = propInfo.type;

        // Resolve type alias to actual values if available
        if (info.typeAliases && info.typeAliases[propInfo.type]) {
          typeDisplay = `"${info.typeAliases[propInfo.type].join('" | "')}"`;
        }

        output += `- \`${propName}${optional}\`: ${typeDisplay}\n`;
        shownProps.add(propName);
      }
    }

    // Show remaining props (up to 3 more non-event, non-internal props)
    let extraCount = 0;
    for (const [propName, propInfo] of Object.entries(info.props)) {
      if (shownProps.has(propName)) continue;
      if (propName.startsWith('on') && propName !== 'onChange' && propName !== 'onClick') continue;
      if (extraCount >= 3) break;

      const optional = propInfo.optional ? '?' : '';
      let typeDisplay = propInfo.type;

      if (info.typeAliases && info.typeAliases[propInfo.type]) {
        typeDisplay = `"${info.typeAliases[propInfo.type].join('" | "')}"`;
      }

      output += `- \`${propName}${optional}\`: ${typeDisplay}\n`;
      extraCount++;
    }

    output += '\n';
  }

  // Add usage example
  if (info.usageExample) {
    output += '**Usage:**\n```tsx\n';
    output += info.usageExample.jsx + '\n';
    output += '```\n\n';
  }

  // Add warning about array exports
  if (info.arrayExports && info.arrayExports.length > 0) {
    output += `⚠️ \`${info.arrayExports.join('`, `')}\` are arrays for iteration, NOT objects.\n\n`;
  }

  return output;
}

// ============================================================
// CLI
// ============================================================

function printUsage() {
  console.log(`
Wogi Flow - Export Scanner

Scans your project for TypeScript/JavaScript exports to build an accurate
import map for the local LLM. This ensures generated code uses only valid imports.

Usage:
  node flow-export-scanner.js [project-root]
  node flow-export-scanner.js --cache     # Use cached map if fresh (5 min)
  node flow-export-scanner.js --clear     # Clear the cache
  node flow-export-scanner.js --format    # Output formatted for templates

Output is saved to: .workflow/state/export-map.json
`);
}

// Main - CLI execution
if (require.main === module) {
  // Set project root from CLI arg (only when running directly as CLI)
  const cliRoot = process.argv[2] && !process.argv[2].startsWith('--')
    ? path.resolve(process.argv[2])
    : process.cwd();
  setProjectRoot(cliRoot);

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (process.argv.includes('--clear')) {
    clearCache();
    process.exit(0);
  }

  const useCache = process.argv.includes('--cache');
  const formatOutput = process.argv.includes('--format');

  let exportMap;

  if (useCache) {
    exportMap = loadCachedExportMap();
    if (exportMap) {
      console.log('Using cached export map');
    }
  }

  if (!exportMap) {
    console.log('Scanning project exports...\n');
    const config = loadConfig();
    exportMap = buildExportMap(config);
    saveExportMapCache(exportMap);
  }

  // Report findings
  const componentCount = Object.keys(exportMap.components).length;
  const hookCount = Object.keys(exportMap.hooks).length;
  const serviceCount = Object.keys(exportMap.services).length;
  const typeCount = Object.keys(exportMap.types).length;
  const utilCount = Object.keys(exportMap.utils).length;

  console.log(`Found exports:`);
  console.log(`  Components: ${componentCount}`);
  console.log(`  Hooks: ${hookCount}`);
  console.log(`  Services: ${serviceCount}`);
  console.log(`  Types: ${typeCount}`);
  console.log(`  Utils: ${utilCount}`);

  if (formatOutput) {
    console.log('\n--- Template Format ---\n');
    console.log(formatExportMapForTemplate(exportMap));
  }

  console.log(`\n✓ Export map saved to ${CACHE_PATH}`);
}

module.exports = {
  // Core scanning functions
  extractExports,
  extractComponentDetails,
  generateUsageExample,
  scanModuleExports,
  scanFileExports,
  buildExportMap,
  // Cache functions
  loadCachedExportMap,
  saveExportMapCache,
  clearCache,
  // Formatting functions
  formatExportMapForTemplate,
  validateComponentUsage,
  formatComponentWithUsage,
  // Configuration functions (for use as module)
  setProjectRoot,
  getProjectRoot,
  loadConfig
};
