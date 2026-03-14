#!/usr/bin/env node

/**
 * Wogi Flow Skill Registry
 *
 * Handles skill installation and management with `flow skill`.
 * Fetches skills from a GitHub-based registry, validates them,
 * and installs them to the project's .claude/skills/ directory.
 *
 * @module lib/skill-registry
 */

const fs = require('node:fs');
const path = require('node:path');

// Shared utilities
const {
  findProjectRoot,
  safeJsonParse,
  safeReadJson,
  httpsGet,
  validatePath,
  safeWriteFile
} = require('./utils');

// Registry configuration
const REGISTRY_CONFIG = {
  baseUrl: 'https://raw.githubusercontent.com/Wogi-Git/wogi-flow-skills',
  branch: 'main',
  manifestFile: 'manifest.json',
  indexFile: 'index.json'
};

// Local cache settings
const CACHE_DIR = '.workflow/cache/skills';
const CACHE_TTL = 3600000; // 1 hour in milliseconds

/**
 * Parse command line arguments with bounds checking
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs(args) {
  const options = {
    command: args[0] || 'list',
    skillName: args[1] || null,
    version: null,
    force: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--version' || arg === '-v') {
      // Bounds check before accessing next argument
      if (i + 1 >= args.length) {
        console.error('Error: --version requires a value');
        options.help = true;
        break;
      }
      options.version = args[++i];
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Usage: flow skill <command> [options]

Manage skills from the Wogi Flow registry.

Commands:
  list                   List available skills from registry
  add <name>             Install a skill
  remove <name>          Remove an installed skill
  update [name]          Update skill(s) to latest version
  info <name>            Show skill details

Options:
  --version, -v <ver>    Install specific version
  --force, -f            Force reinstall or overwrite
  --help, -h             Show this help message

Examples:
  flow skill list                    # List all available skills
  flow skill add react               # Install react skill
  flow skill add nestjs -v 1.2.0     # Install specific version
  flow skill remove react            # Remove skill
  flow skill update                  # Update all skills
  flow skill info react              # Show skill details
`);
}

// findProjectRoot and httpsGet are imported from ./utils

/**
 * Fetch with caching
 * @param {string} url - URL to fetch
 * @param {string} cacheKey - Cache key
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<string>} Response body
 */
async function fetchWithCache(url, cacheKey, projectRoot) {
  const cacheDir = path.join(projectRoot, CACHE_DIR);
  const cachePath = path.join(cacheDir, `${cacheKey}.json`);

  // Check cache
  if (fs.existsSync(cachePath)) {
    const cached = safeReadJson(cachePath);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  // Fetch fresh
  const data = await httpsGet(url);

  // Save to cache
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (_err) {
    // Cache write failed, continue anyway
  }

  return data;
}

/**
 * Fetch skill index from registry
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<Object>} Skill index
 */
async function fetchSkillIndex(projectRoot) {
  const url = `${REGISTRY_CONFIG.baseUrl}/${REGISTRY_CONFIG.branch}/${REGISTRY_CONFIG.indexFile}`;

  try {
    const data = await fetchWithCache(url, 'index', projectRoot);
    const parsed = safeJsonParse(data);
    if (!parsed) {
      throw new Error('Invalid index data');
    }
    return parsed;
  } catch (err) {
    // Return mock index for development/offline
    return {
      version: '1.0',
      skills: {
        react: {
          name: 'react',
          title: 'React',
          description: 'React component patterns and best practices',
          version: '1.0.0',
          author: 'Wogi-Git'
        },
        nestjs: {
          name: 'nestjs',
          title: 'NestJS',
          description: 'NestJS module patterns with entities, DTOs, services',
          version: '1.0.0',
          author: 'Wogi-Git'
        },
        python: {
          name: 'python',
          title: 'Python',
          description: 'Python/FastAPI patterns and best practices',
          version: '1.0.0',
          author: 'Wogi-Git'
        }
      }
    };
  }
}

/**
 * Fetch skill manifest from registry
 * @param {string} skillName - Skill name
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<Object>} Skill manifest
 */
async function fetchSkillManifest(skillName, projectRoot) {
  const url = `${REGISTRY_CONFIG.baseUrl}/${REGISTRY_CONFIG.branch}/skills/${skillName}/${REGISTRY_CONFIG.manifestFile}`;

  try {
    const data = await fetchWithCache(url, `manifest-${skillName}`, projectRoot);
    const parsed = safeJsonParse(data);
    if (!parsed) {
      throw new Error('Invalid manifest data');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Skill '${skillName}' not found in registry`);
  }
}

/**
 * Download skill files
 * @param {string} skillName - Skill name
 * @param {Object} manifest - Skill manifest
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<Object>} Downloaded files
 */
async function downloadSkillFiles(skillName, manifest, projectRoot) {
  const files = {};
  const baseUrl = `${REGISTRY_CONFIG.baseUrl}/${REGISTRY_CONFIG.branch}/skills/${skillName}`;

  // Standard skill files
  const standardFiles = ['skill.md', 'patterns.md', 'anti-patterns.md', 'learnings.md'];
  const filesToDownload = manifest.files || standardFiles;

  for (const file of filesToDownload) {
    try {
      const url = `${baseUrl}/${file}`;
      const content = await httpsGet(url);
      files[file] = content;
    } catch (_err) {
      // File doesn't exist, skip
    }
  }

  return files;
}

/**
 * Get installed skills
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Installed skills map
 */
function getInstalledSkills(projectRoot) {
  const skillsDir = path.join(projectRoot, '.claude', 'skills');
  const installed = {};

  if (!fs.existsSync(skillsDir)) {
    return installed;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const manifestPath = path.join(skillsDir, entry.name, 'manifest.json');
      const manifest = safeReadJson(manifestPath);
      if (manifest) {
        installed[entry.name] = manifest;
      } else {
        installed[entry.name] = { name: entry.name, version: 'unknown' };
      }
    }
  }

  return installed;
}

/**
 * List available skills
 * @param {string} projectRoot - Project root directory
 */
async function listSkills(projectRoot) {
  console.log('\n📦 Available Skills\n');

  const index = await fetchSkillIndex(projectRoot);
  const installed = getInstalledSkills(projectRoot);

  const skills = Object.values(index.skills || {});

  if (skills.length === 0) {
    console.log('  No skills available in registry');
    return;
  }

  for (const skill of skills) {
    const isInstalled = installed[skill.name];
    const status = isInstalled ? '✓' : ' ';
    const versionInfo = isInstalled
      ? `(installed: ${isInstalled.version})`
      : `(v${skill.version})`;

    console.log(`  ${status} ${skill.name.padEnd(15)} ${versionInfo}`);
    console.log(`    ${skill.description}`);
  }

  console.log('\nUse `flow skill add <name>` to install a skill');
}

/**
 * Install a skill
 * @param {string} skillName - Skill name
 * @param {string} projectRoot - Project root directory
 * @param {Object} options - Installation options
 */
async function addSkill(skillName, projectRoot, options) {
  const skillsDir = path.join(projectRoot, '.claude', 'skills', skillName);

  // Check if already installed
  if (fs.existsSync(skillsDir) && !options.force) {
    console.log(`Skill '${skillName}' is already installed.`);
    console.log('Use --force to reinstall.');
    return;
  }

  console.log(`\nInstalling skill: ${skillName}\n`);

  // Fetch manifest
  let manifest;
  try {
    manifest = await fetchSkillManifest(skillName, projectRoot);
  } catch (err) {
    // Use index info if manifest not found
    const index = await fetchSkillIndex(projectRoot);
    if (index.skills && index.skills[skillName]) {
      manifest = index.skills[skillName];
    } else {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  }

  // Download files
  console.log('  Downloading files...');
  const files = await downloadSkillFiles(skillName, manifest, projectRoot);

  if (Object.keys(files).length === 0) {
    console.error('Error: No skill files found');
    process.exit(1);
  }

  // Create skill directory
  fs.mkdirSync(skillsDir, { recursive: true });

  // Write files with path validation (prevents path traversal)
  for (const [filename, content] of Object.entries(files)) {
    // Use basename to prevent path traversal attacks like "../../../etc/passwd"
    const safeFilename = path.basename(filename);
    const targetPath = validatePath(skillsDir, safeFilename);
    if (!targetPath) {
      console.error(`  Warning: Skipping invalid filename '${filename}'`);
      continue;
    }
    fs.writeFileSync(targetPath, content);
  }

  // Write manifest (safe - we control the filename)
  const localManifest = {
    ...manifest,
    installedAt: new Date().toISOString(),
    installedVersion: manifest.version
  };
  fs.writeFileSync(
    path.join(skillsDir, 'manifest.json'),
    JSON.stringify(localManifest, null, 2)
  );

  console.log(`  ✓ Installed ${Object.keys(files).length} files`);
  console.log(`\n✅ Skill '${skillName}' installed successfully!\n`);
  console.log(`Files: .claude/skills/${skillName}/`);
}

/**
 * Remove a skill
 * @param {string} skillName - Skill name
 * @param {string} projectRoot - Project root directory
 */
function removeSkill(skillName, projectRoot) {
  const skillsDir = path.join(projectRoot, '.claude', 'skills', skillName);

  if (!fs.existsSync(skillsDir)) {
    console.log(`Skill '${skillName}' is not installed.`);
    return;
  }

  // Remove directory recursively
  fs.rmSync(skillsDir, { recursive: true });

  console.log(`✓ Removed skill: ${skillName}`);
}

/**
 * Update skills
 * @param {string|null} skillName - Skill name or null for all
 * @param {string} projectRoot - Project root directory
 */
async function updateSkills(skillName, projectRoot) {
  const installed = getInstalledSkills(projectRoot);

  if (Object.keys(installed).length === 0) {
    console.log('No skills installed.');
    return;
  }

  const skillsToUpdate = skillName
    ? [skillName]
    : Object.keys(installed);

  console.log('\n🔄 Updating skills...\n');

  const index = await fetchSkillIndex(projectRoot);

  for (const name of skillsToUpdate) {
    if (!installed[name]) {
      console.log(`  ⚠ ${name}: not installed`);
      continue;
    }

    const registryVersion = index.skills?.[name]?.version || 'unknown';
    const installedVersion = installed[name].version || 'unknown';

    if (registryVersion === installedVersion && registryVersion !== 'unknown') {
      console.log(`  ✓ ${name}: up to date (${installedVersion})`);
    } else {
      console.log(`  ↑ ${name}: ${installedVersion} → ${registryVersion}`);
      await addSkill(name, projectRoot, { force: true });
    }
  }
}

/**
 * Show skill info
 * @param {string} skillName - Skill name
 * @param {string} projectRoot - Project root directory
 */
async function showSkillInfo(skillName, projectRoot) {
  const index = await fetchSkillIndex(projectRoot);
  const installed = getInstalledSkills(projectRoot);

  const skill = index.skills?.[skillName];

  if (!skill) {
    console.log(`Skill '${skillName}' not found in registry.`);
    return;
  }

  console.log(`\n📦 ${skill.title || skill.name}\n`);
  console.log(`  Name:        ${skill.name}`);
  console.log(`  Version:     ${skill.version}`);
  console.log(`  Author:      ${skill.author || 'Unknown'}`);
  console.log(`  Description: ${skill.description}`);

  if (installed[skillName]) {
    console.log(`\n  Status:      Installed (v${installed[skillName].version})`);
    if (installed[skillName].installedAt) {
      console.log(`  Installed:   ${installed[skillName].installedAt}`);
    }
  } else {
    console.log(`\n  Status:      Not installed`);
  }

  console.log('');
}

/**
 * Main skill registry function
 * @param {string[]} args - Command line arguments
 */
async function skill(args) {
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    console.error('Error: Not in a Wogi Flow project');
    console.error('Use `flow init` to initialize a new project');
    process.exit(1);
  }

  switch (options.command) {
    case 'list':
      await listSkills(projectRoot);
      break;

    case 'add':
      if (!options.skillName) {
        console.error('Error: Please specify a skill name');
        console.error('Usage: flow skill add <name>');
        process.exit(1);
      }
      await addSkill(options.skillName, projectRoot, options);
      break;

    case 'remove':
      if (!options.skillName) {
        console.error('Error: Please specify a skill name');
        console.error('Usage: flow skill remove <name>');
        process.exit(1);
      }
      removeSkill(options.skillName, projectRoot);
      break;

    case 'update':
      await updateSkills(options.skillName, projectRoot);
      break;

    case 'info':
      if (!options.skillName) {
        console.error('Error: Please specify a skill name');
        console.error('Usage: flow skill info <name>');
        process.exit(1);
      }
      await showSkillInfo(options.skillName, projectRoot);
      break;

    default:
      console.error(`Unknown command: ${options.command}`);
      showHelp();
      process.exit(1);
  }
}

module.exports = { skill };
