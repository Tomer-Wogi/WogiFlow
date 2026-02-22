#!/usr/bin/env node

/**
 * Wogi Flow - Skill Creation Wizard
 *
 * Creates new skills from templates with interactive prompts.
 *
 * Usage:
 *   flow skill-create                  # Interactive mode
 *   flow skill-create <name>           # Create with name
 *   flow skill-create <name> --from-patterns  # Create from feedback patterns
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getProjectRoot, colors } = require('./flow-utils');
const { getAllSkills, getSkillDir } = require('./flow-skill-matcher');

const PROJECT_ROOT = getProjectRoot();
const SKILLS_DIR = path.join(PROJECT_ROOT, '.claude', 'skills');
const TEMPLATE_DIR = path.join(SKILLS_DIR, '_template');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

async function prompt(question, defaultValue = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const defaultHint = defaultValue ? ` (${defaultValue})` : '';

  return new Promise(resolve => {
    rl.question(`${question}${defaultHint}: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function confirm(question) {
  const answer = await prompt(`${question} (y/N)`);
  return answer.toLowerCase() === 'y';
}

function copyDirectory(src, dest, replacements = {}) {
  if (!fs.existsSync(src)) {
    return false;
  }

  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath, replacements);
    } else {
      let content = fs.readFileSync(srcPath, 'utf-8');

      // Apply replacements
      for (const [key, value] of Object.entries(replacements)) {
        content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }

      fs.writeFileSync(destPath, content);
    }
  }

  return true;
}

async function createSkill(name, options = {}) {
  // Support nested paths like "frontend/react" or "backend/nestjs"
  const pathParts = name.split('/').filter(Boolean);
  const skillPath = path.join(SKILLS_DIR, ...pathParts);
  const displayName = pathParts[pathParts.length - 1]; // Base name for display

  if (fs.existsSync(skillPath)) {
    log('red', `Skill '${name}' already exists at ${skillPath}`);
    return false;
  }

  // Create parent directories if nested
  if (pathParts.length > 1) {
    const parentDir = path.join(SKILLS_DIR, ...pathParts.slice(0, -1));
    fs.mkdirSync(parentDir, { recursive: true });
  }

  log('cyan', `\n📦 Creating skill: ${name}\n`);
  if (pathParts.length > 1) {
    log('dim', `   (nested skill at ${skillPath})\n`);
  }

  // Gather information
  const description = options.description || await prompt('Short description');
  const filePatterns = options.filePatterns || await prompt('File patterns (comma-separated)', '*.ts');
  const useCases = options.useCases || await prompt('Use cases (comma-separated)', 'General development');

  const today = new Date().toISOString().split('T')[0];

  const replacements = {
    SKILL_NAME: name,
    SHORT_DESCRIPTION: description,
    DATE: today,
    FILE_PATTERN_1: filePatterns.split(',')[0]?.trim() || '*.ts',
    FILE_PATTERN_2: filePatterns.split(',')[1]?.trim() || '*.tsx',
    USE_CASE_1: useCases.split(',')[0]?.trim() || 'General development',
    USE_CASE_2: useCases.split(',')[1]?.trim() || 'Code generation'
  };

  // Copy template
  if (!fs.existsSync(TEMPLATE_DIR)) {
    log('yellow', 'Template directory not found, creating basic structure...');

    fs.mkdirSync(skillPath, { recursive: true });
    fs.mkdirSync(path.join(skillPath, 'knowledge'));
    fs.mkdirSync(path.join(skillPath, 'rules'));
    fs.mkdirSync(path.join(skillPath, 'commands'));
    fs.mkdirSync(path.join(skillPath, 'templates'));

    // Create minimal skill.md
    const skillMd = `---
name: ${name}
version: 1.0.0
description: ${description}
scope: project
lastUpdated: ${today}
learningCount: 0
successRate: 0
---

# ${name} Skill

## When to Use

- ${replacements.USE_CASE_1}
- ${replacements.USE_CASE_2}

## File Patterns

- \`${replacements.FILE_PATTERN_1}\`
- \`${replacements.FILE_PATTERN_2}\`

## Quick Reference

_Add key patterns here._

## Progressive Content

| File | When to Load |
|------|--------------|
| \`knowledge/learnings.md\` | Starting a task |
| \`knowledge/patterns.md\` | Looking for examples |
| \`rules/conventions.md\` | Writing code |
`;

    fs.writeFileSync(path.join(skillPath, 'skill.md'), skillMd);

    // Create empty knowledge files
    fs.writeFileSync(path.join(skillPath, 'knowledge', 'learnings.md'), '# Learnings Log\n\n_No learnings yet._\n');
    fs.writeFileSync(path.join(skillPath, 'knowledge', 'patterns.md'), '# Successful Patterns\n\n_No patterns yet._\n');
    fs.writeFileSync(path.join(skillPath, 'knowledge', 'anti-patterns.md'), '# Anti-Patterns\n\n_No anti-patterns yet._\n');

  } else {
    copyDirectory(TEMPLATE_DIR, skillPath, replacements);
  }

  log('green', `\n✅ Skill created: ${skillPath}\n`);

  log('white', 'Next steps:');
  log('dim', `  1. Edit ${path.join(skillPath, 'skill.md')} to customize`);
  log('dim', `  2. Add rules to ${path.join(skillPath, 'rules/')}`);
  log('dim', `  3. Add commands to ${path.join(skillPath, 'commands/')}`);
  log('dim', `  4. Install with: /wogi-skills add ${name}`);

  return true;
}

async function createFromPatterns() {
  const feedbackPath = path.join(PROJECT_ROOT, '.workflow', 'state', 'feedback-patterns.md');

  if (!fs.existsSync(feedbackPath)) {
    log('yellow', 'No feedback-patterns.md found');
    return;
  }

  const content = fs.readFileSync(feedbackPath, 'utf-8');

  // Find entries with #needs-skill tag
  const lines = content.split('\n');
  const needsSkill = lines.filter(line => line.includes('#needs-skill'));

  if (needsSkill.length === 0) {
    log('dim', 'No patterns flagged with #needs-skill');
    return;
  }

  log('cyan', `\nFound ${needsSkill.length} patterns needing skills:\n`);

  for (const line of needsSkill.slice(0, 5)) {
    log('dim', `  ${line}`);
  }

  console.log('');

  // Extract common file extensions
  const extensions = new Set();
  for (const line of needsSkill) {
    const extMatch = line.match(/\.(ts|tsx|js|jsx|py|go|rs|java|rb|vue|svelte)/g);
    if (extMatch) {
      extMatch.forEach(ext => extensions.add('*' + ext));
    }
  }

  if (extensions.size > 0) {
    const suggestedPatterns = Array.from(extensions).join(', ');
    const shouldCreate = await confirm(`Create skill for patterns: ${suggestedPatterns}?`);

    if (shouldCreate) {
      const name = await prompt('Skill name');
      await createSkill(name, { filePatterns: suggestedPatterns });
    }
  }
}

function showHelp() {
  console.log(`
Wogi Flow Skill Creator

Usage:
  flow skill-create                     # Interactive mode
  flow skill-create <name>              # Create skill with name
  flow skill-create --from-patterns     # Create from feedback patterns
  flow skill-create --list              # List existing skills

Options:
  --from-patterns    Analyze feedback-patterns.md for skill candidates
  --list             List existing skills
  --help, -h         Show this help

Examples:
  flow skill-create react               # Create 'react' skill
  flow skill-create --from-patterns     # Create from accumulated patterns
`);
}

function listSkills() {
  const skills = getAllSkills();

  if (skills.length === 0) {
    log('dim', 'No skills found');
    return;
  }

  log('cyan', '\nInstalled Skills:\n');

  for (const skill of skills) {
    const skillPath = getSkillDir(skill.name);
    const hasKnowledge = fs.existsSync(path.join(skillPath, 'knowledge'));
    const knowledgeIcon = hasKnowledge ? '\u{1F4DA}' : '\u{1F4E6}';

    log('white', `  ${knowledgeIcon} ${skill.name}`);

    if (skill.metadata?.description) {
      log('dim', `     ${skill.metadata.description}`);
    }
  }

  console.log('');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--list')) {
    listSkills();
    process.exit(0);
  }

  if (args.includes('--from-patterns')) {
    await createFromPatterns();
    process.exit(0);
  }

  // Get skill name from args or prompt
  let name = args.find(a => !a.startsWith('-'));

  if (!name) {
    log('cyan', '\n🛠️  Skill Creation Wizard\n');
    name = await prompt('Skill name (lowercase, no spaces)');
  }

  if (!name) {
    log('red', 'Skill name is required');
    process.exit(1);
  }

  // Validate name
  const validName = /^[a-z][a-z0-9-]*$/;
  if (!validName.test(name)) {
    log('red', 'Skill name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens');
    process.exit(1);
  }

  await createSkill(name);
}

main().catch(err => {
  log('red', `Error: ${err.message}`);
  process.exit(1);
});
