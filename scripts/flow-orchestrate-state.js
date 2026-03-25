#!/usr/bin/env node
/**
 * State Manager - Extracted from flow-orchestrate.js
 *
 * Manages request logging, app-map updates, hybrid session state,
 * and project context loading for the orchestrator.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getProjectRoot, colors, getConfig, writeJson, PATHS } = require('./flow-utils');
const { readJson } = require('./flow-io');
const { loadCachedExportMap } = require('./flow-export-scanner');
const durableSession = require('./flow-durable-session');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

class StateManager {
  updateRequestLog(step, status, mode = 'hybrid', executor = '') {
    const logPath = PATHS.requestLog;
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

    const entry = `
## ${timestamp} - ${step.title}

**Status:** ${status}
**Type:** ${step.type}
**Mode:** ${mode}${executor ? ` (${executor})` : ''}
${step.params?.path ? `**File:** \`${step.params.path}\`` : ''}

${step.description || ''}

---
`;

    if (fs.existsSync(logPath)) {
      fs.appendFileSync(logPath, entry);
    }
  }

  updateAppMap(update) {
    if (!update) return;

    const mapPath = PATHS.appMap;
    if (!fs.existsSync(mapPath)) return;

    let content = fs.readFileSync(mapPath, 'utf-8');
    const { section, entry } = update;

    const sectionRegex = new RegExp(`(## ${section}[\\s\\S]*?)(\n## |$)`);
    const match = content.match(sectionRegex);

    if (match) {
      const [, sectionContent, nextSection] = match;
      const newSection = sectionContent.trimEnd() + `\n- ${entry}\n\n`;
      content = content.replace(sectionRegex, newSection + (nextSection === '\n## ' ? '\n## ' : ''));
      fs.writeFileSync(mapPath, content);
    }
  }

  /**
   * Update hybrid session state
   * v2.0: Delegates to durable session when enabled
   */
  updateHybridSession(data) {
    const config = getConfig();

    // v2.0: Use durable session if enabled
    if (config.durableSteps?.enabled !== false) {
      // Update durable session with hybrid-specific data
      const dsSession = durableSession.loadDurableSession();
      if (dsSession) {
        // Track tokens saved
        if (data.totalTokensSaved) {
          durableSession.addTokensSaved(data.totalTokensSaved - (dsSession.metrics.tokensSaved || 0));
        }

        // If executedSteps changed, mark corresponding steps as completed
        if (data.executedSteps) {
          for (const stepId of data.executedSteps) {
            const step = dsSession.steps.find(s => s.id === stepId || s.description?.includes(stepId));
            if (step && step.status !== durableSession.STEP_STATUS.COMPLETED) {
              durableSession.markStepCompleted(step.id, 'Executed by orchestrator');
            }
          }
        }

        // If failedSteps changed, mark corresponding steps as failed
        if (data.failedSteps) {
          for (const stepId of data.failedSteps) {
            const step = dsSession.steps.find(s => s.id === stepId || s.description?.includes(stepId));
            if (step && step.status !== durableSession.STEP_STATUS.FAILED) {
              durableSession.markStepFailed(step.id, 'Failed in orchestrator');
            }
          }
        }

        return durableSession.getHybridSession();
      }
    }

    // Legacy fallback: write to hybrid-session.json directly
    // DEPRECATED: This path is kept for backward compatibility but will be removed
    // Enable durableSteps in config.json to use the modern session management
    console.warn('[DEPRECATED] Using legacy hybrid-session.json - enable durableSteps.enabled in config.json');
    const sessionPath = path.join(PATHS.state, 'hybrid-session.json');

    let session = {
      sessionId: `sess-${Date.now()}`,
      startedAt: new Date().toISOString(),
      autoExecute: false,
      currentPlan: null,
      executedSteps: [],
      failedSteps: [],
      pendingSteps: [],
      totalTokensSaved: 0
    };

    const existingSession = readJson(sessionPath, null);
    if (existingSession) {
      session = { ...session, ...existingSession };
    }

    Object.assign(session, data);
    session.updatedAt = new Date().toISOString();

    // Use atomic writeJson to prevent data corruption
    writeJson(sessionPath, session);
    return session;
  }

  /**
   * Get hybrid session state
   * v2.0: Returns durable session in hybrid format when enabled
   */
  getHybridSession() {
    const config = getConfig();

    // v2.0: Use durable session if enabled
    if (config.durableSteps?.enabled !== false) {
      return durableSession.getHybridSession();
    }

    // Legacy fallback - DEPRECATED
    const sessionPath = path.join(PATHS.state, 'hybrid-session.json');
    const legacySession = readJson(sessionPath, null);
    if (legacySession) {
      console.warn('[DEPRECATED] Reading legacy hybrid-session.json - enable durableSteps.enabled in config.json');
      return legacySession;
    }
    return null;
  }

  saveResults(results) {
    const resultsPath = path.join(PATHS.state, 'hybrid-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  }

  /**
   * Loads project context from config.json, export map, and app-map.md.
   * Returns context that can be used in templates.
   *
   * Reads from:
   * - config.json → hybrid.projectContext (primary source)
   * - export-map.json (scanned exports)
   * - app-map.md (supplemental component info)
   */
  loadProjectContext() {
    const context = {
      importPatterns: '',
      availableComponents: '',
      availableHooks: '',
      availableServices: '',
      availableTypes: '',
      availableUtils: '',
      typeLocations: '',
      uiFramework: 'react',
      stylingApproach: '',
      doNotImport: '',
      projectWarnings: '',
      customRules: '',
      projectContext: null,
      exportMap: null
    };

    // Try to load from config (primary source)
    const configPath = path.join(PATHS.workflow, 'config.json');
    const config = readJson(configPath, null);
    if (config) {
      const projectCtx = config.hybrid?.projectContext || {};

      // Store raw project context for auto-correction
      context.projectContext = projectCtx;

      // UI Framework
      if (projectCtx.uiFramework) {
        context.uiFramework = projectCtx.uiFramework;
      }

      // Styling approach
      if (projectCtx.stylingApproach) {
        context.stylingApproach = projectCtx.stylingApproach;
      }

      // Format forbidden imports
      if (projectCtx.doNotImport?.length > 0) {
        context.doNotImport = projectCtx.doNotImport.join(', ');
      }

      // Format project warnings
      if (projectCtx.projectWarnings?.length > 0) {
        context.projectWarnings = projectCtx.projectWarnings.map(w => `- ⚠️ ${w}`).join('\n');
      }

      // Format custom rules
      if (projectCtx.customRules?.length > 0) {
        context.customRules = projectCtx.customRules.map(r => `- ${r}`).join('\n');
      }

      // Format type locations
      if (projectCtx.typeLocations && Object.keys(projectCtx.typeLocations).length > 0) {
        context.typeLocations = Object.entries(projectCtx.typeLocations)
          .map(([scope, importPath]) => `- In ${scope}: \`import type { X } from '${importPath}'\``)
          .join('\n');
      }
    }

    // Load export map for accurate imports
    const exportMap = loadCachedExportMap();
    if (exportMap) {
      context.exportMap = exportMap;

      // Format components
      if (Object.keys(exportMap.components).length > 0) {
        context.availableComponents = Object.entries(exportMap.components)
          .map(([name, info]) => {
            if (info.exports.length > 0) {
              return `import { ${info.exports.join(', ')} } from '${info.importPath}';`;
            } else if (info.defaultExport) {
              return `import ${info.defaultExport} from '${info.importPath}';`;
            }
            return null;
          })
          .filter(Boolean)
          .join('\n');
      }

      // Format hooks
      if (Object.keys(exportMap.hooks).length > 0) {
        context.availableHooks = Object.entries(exportMap.hooks)
          .map(([name, info]) => info.exports.length > 0
            ? `import { ${info.exports.join(', ')} } from '${info.importPath}';`
            : null)
          .filter(Boolean)
          .join('\n');
      }

      // Format services
      if (Object.keys(exportMap.services).length > 0) {
        context.availableServices = Object.entries(exportMap.services)
          .map(([name, info]) => info.exports.length > 0
            ? `import { ${info.exports.join(', ')} } from '${info.importPath}';`
            : null)
          .filter(Boolean)
          .join('\n');
      }

      // Format types
      if (Object.keys(exportMap.types).length > 0) {
        context.availableTypes = Object.entries(exportMap.types)
          .map(([name, info]) => info.types?.length > 0
            ? `import type { ${info.types.join(', ')} } from '${info.importPath}';`
            : null)
          .filter(Boolean)
          .join('\n');
      }

      // Format utils
      if (Object.keys(exportMap.utils).length > 0) {
        context.availableUtils = Object.entries(exportMap.utils)
          .map(([name, info]) => info.exports.length > 0
            ? `import { ${info.exports.join(', ')} } from '${info.importPath}';`
            : null)
          .filter(Boolean)
          .join('\n');
      }
    }

    // Supplement with app-map.md if no exports found
    const appMapPath = PATHS.appMap;
    if (fs.existsSync(appMapPath) && !context.availableComponents) {
      try {
        const appMap = fs.readFileSync(appMapPath, 'utf-8');

        // Extract component sections
        const componentMatch = appMap.match(/## Components[\s\S]*?(?=##|$)/i);
        if (componentMatch) {
          context.availableComponents = componentMatch[0].trim();
        }

        // Extract screens/features
        const screensMatch = appMap.match(/## Screens[\s\S]*?(?=##|$)/i);
        if (screensMatch) {
          context.availableComponents += '\n\n' + screensMatch[0].trim();
        }
      } catch (err) {
        log('dim', `   ⚠️ Could not parse app-map.md: ${err.message}`);
      }
    }

    return context;
  }
}

module.exports = { StateManager };
