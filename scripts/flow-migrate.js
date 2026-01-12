#!/usr/bin/env node

/**
 * Wogi Flow - Migration Helper
 *
 * Handles migration of files from old locations to new ones.
 *
 * Usage:
 *   flow migrate specs      Move spec files from state/ to specs/
 *   flow migrate check      Check what needs migration (dry-run)
 *   flow migrate --help     Show help
 */

const fs = require('fs');
const path = require('path');

const {
  PATHS,
  PROJECT_ROOT,
  WORKFLOW_DIR,
  fileExists,
  dirExists,
  parseFlags,
  outputJson,
  printHeader,
  printSection,
  color,
  success,
  warn,
  error,
  info,
  checkSpecMigration,
  SPEC_FILE_MAP
} = require('./flow-utils');

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Usage: flow migrate <command> [options]

Commands:
  specs       Move spec files from state/ to specs/
  check       Check what needs migration (dry-run)
  all         Run all migrations

Options:
  --dry-run   Show what would be done without making changes
  --json      Output in JSON format
  --help      Show this help message

Examples:
  flow migrate check        # See what needs migration
  flow migrate specs        # Move spec files
  flow migrate all          # Run all migrations
  flow migrate specs --dry-run  # Preview without changes
`);
}

/**
 * Check what needs migration
 */
function checkMigration(flags) {
  const results = {
    specs: checkSpecMigration(),
    total: 0
  };

  results.total = results.specs.length;

  if (flags.json) {
    outputJson({
      success: true,
      needsMigration: results.total > 0,
      migrations: results
    });
    return;
  }

  printHeader('MIGRATION CHECK');

  // Spec files
  printSection('Spec Files (state/ → specs/)');
  if (results.specs.length === 0) {
    console.log(`  ${color('green', '✓')} All spec files in correct location`);
  } else {
    for (const file of results.specs) {
      console.log(`  ${color('yellow', '⚠')} ${file.name}.md needs migration`);
      console.log(`      from: ${path.relative(PROJECT_ROOT, file.from)}`);
      console.log(`      to:   ${path.relative(PROJECT_ROOT, file.to)}`);
    }
  }

  console.log('');

  if (results.total === 0) {
    success('No migrations needed!');
  } else {
    warn(`${results.total} file(s) need migration`);
    info('Run "flow migrate all" to apply migrations');
  }
}

/**
 * Migrate spec files from state/ to specs/
 */
function migrateSpecs(flags) {
  const filesToMigrate = checkSpecMigration();

  if (filesToMigrate.length === 0) {
    if (flags.json) {
      outputJson({ success: true, migrated: 0, message: 'No spec files need migration' });
    } else {
      success('All spec files already in correct location (specs/)');
    }
    return { success: true, migrated: 0 };
  }

  if (flags.json && flags.dryRun) {
    outputJson({
      success: true,
      dryRun: true,
      wouldMigrate: filesToMigrate.map(f => ({
        name: f.name,
        from: path.relative(PROJECT_ROOT, f.from),
        to: path.relative(PROJECT_ROOT, f.to)
      }))
    });
    return { success: true, migrated: 0 };
  }

  printSection('Migrating spec files...');

  // Ensure specs directory exists
  const specsDir = path.join(WORKFLOW_DIR, 'specs');
  if (!dirExists(specsDir)) {
    fs.mkdirSync(specsDir, { recursive: true });
  }

  let migrated = 0;
  const errors = [];

  for (const file of filesToMigrate) {
    const fromRel = path.relative(PROJECT_ROOT, file.from);
    const toRel = path.relative(PROJECT_ROOT, file.to);

    if (flags.dryRun) {
      console.log(`  ${color('cyan', '→')} Would move ${fromRel} → ${toRel}`);
      migrated++;
      continue;
    }

    try {
      // Copy first (safer than move) - avoid TOCTOU by verifying content
      const content = fs.readFileSync(file.from, 'utf-8');
      fs.writeFileSync(file.to, content);

      // Verify copy succeeded by comparing content (not just existence)
      const writtenContent = fs.readFileSync(file.to, 'utf-8');
      if (content !== writtenContent) {
        throw new Error('Copy verification failed - content mismatch');
      }

      // Now safe to remove original
      fs.unlinkSync(file.from);
      console.log(`  ${color('green', '✓')} Moved ${fromRel} → ${toRel}`);
      migrated++;
    } catch (err) {
      console.log(`  ${color('red', '✗')} Failed to migrate ${fromRel}: ${err.message}`);
      errors.push({ file: file.name, error: err.message });
    }
  }

  // Also migrate templates if they exist
  const templateMigrations = [
    { name: 'stack.md.template', from: path.join(PATHS.state, 'stack.md.template'), to: path.join(specsDir, 'stack.md.template') },
    { name: 'architecture.md.template', from: path.join(PATHS.state, 'architecture.md.template'), to: path.join(specsDir, 'architecture.md.template') },
    { name: 'testing.md.template', from: path.join(PATHS.state, 'testing.md.template'), to: path.join(specsDir, 'testing.md.template') }
  ];

  for (const tmpl of templateMigrations) {
    const fromRel = path.relative(PROJECT_ROOT, tmpl.from);
    const toRel = path.relative(PROJECT_ROOT, tmpl.to);

    // Use try-catch to handle race conditions atomically instead of check-then-act
    try {
      // Try to read source - will throw if doesn't exist
      const content = fs.readFileSync(tmpl.from, 'utf-8');

      // Check if destination already exists by trying to read it
      try {
        fs.readFileSync(tmpl.to, 'utf-8');
        // Destination exists, skip this file
        continue;
      } catch {
        // Destination doesn't exist - proceed with migration
      }

      if (flags.dryRun) {
        console.log(`  ${color('cyan', '→')} Would move ${fromRel} → ${toRel}`);
        migrated++;
        continue;
      }

      fs.writeFileSync(tmpl.to, content);

      // Verify by comparing content (not just existence check)
      const writtenContent = fs.readFileSync(tmpl.to, 'utf-8');
      if (content !== writtenContent) {
        throw new Error('Copy verification failed - content mismatch');
      }

      fs.unlinkSync(tmpl.from);
      console.log(`  ${color('green', '✓')} Moved ${fromRel} → ${toRel}`);
      migrated++;
    } catch (err) {
      // ENOENT means source doesn't exist - that's ok, skip silently
      if (err.code !== 'ENOENT') {
        console.log(`  ${color('red', '✗')} Failed to migrate ${fromRel}: ${err.message}`);
        errors.push({ file: tmpl.name, error: err.message });
      }
    }
  }

  console.log('');

  if (flags.json) {
    outputJson({
      success: errors.length === 0,
      dryRun: flags.dryRun,
      migrated,
      errors
    });
    return;
  }

  if (errors.length > 0) {
    error(`Migration completed with ${errors.length} error(s)`);
    return { success: false, migrated, errors };
  }

  if (flags.dryRun) {
    info(`Dry run: ${migrated} file(s) would be migrated`);
  } else {
    success(`Migrated ${migrated} file(s) to specs/`);
  }

  return { success: true, migrated };
}

/**
 * Run all migrations
 */
function migrateAll(flags) {
  printHeader('RUNNING ALL MIGRATIONS');

  const results = {
    specs: migrateSpecs(flags)
  };

  console.log('');

  if (flags.json) {
    outputJson({
      success: Object.values(results).every(r => r.success),
      migrations: results
    });
    return;
  }

  const totalMigrated = Object.values(results).reduce((sum, r) => sum + (r.migrated || 0), 0);
  const anyErrors = Object.values(results).some(r => !r.success);

  if (anyErrors) {
    error('Some migrations failed. Check output above for details.');
  } else if (totalMigrated === 0) {
    success('No migrations needed - everything is up to date!');
  } else {
    success(`All migrations complete! (${totalMigrated} files)`);
  }
}

// ============================================================
// Main
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);

  if (flags.help || positional.length === 0) {
    showHelp();
    return;
  }

  const command = positional[0];

  switch (command) {
    case 'check':
      checkMigration(flags);
      break;
    case 'specs':
      migrateSpecs(flags);
      break;
    case 'all':
      migrateAll(flags);
      break;
    default:
      error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main();
