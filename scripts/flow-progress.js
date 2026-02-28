#!/usr/bin/env node

/**
 * Wogi Flow - Progress Display Utilities
 *
 * Provides visual feedback during hybrid execution.
 */

const readline = require('readline');
const { colors } = require('./flow-utils');

const symbols = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  pending: '⏳',
  running: '🔄',
  skip: '⏭️',
  parallel: '⚡',
  rollback: '🔙',
  plan: '📋',
  step: '📍',
  file: '📄',
  folder: '📁',
  check: '✓',
  cross: '✗',
  arrow: '→',
  bullet: '•'
};

class ProgressBar {
  constructor(total, width = 30) {
    this.total = total;
    this.current = 0;
    this.width = width;
    this.startTime = Date.now();
  }

  update(current, label = '') {
    this.current = current;
    const percent = Math.floor((current / this.total) * 100);
    const filled = Math.floor((current / this.total) * this.width);
    const empty = this.width - filled;

    const bar = colors.green + '█'.repeat(filled) + colors.dim + '░'.repeat(empty) + colors.reset;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

    const line = `  [${bar}] ${percent}% ${label} ${colors.dim}(${elapsed}s)${colors.reset}`;

    process.stdout.write('\r' + ' '.repeat(80) + '\r');
    process.stdout.write(line);
  }

  complete(label = 'Complete') {
    this.update(this.total, label);
    console.log('');
  }
}

class Spinner {
  constructor(text = 'Loading') {
    this.text = text;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.frameIndex = 0;
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex];
      process.stdout.write(`\r${colors.cyan}${frame}${colors.reset} ${this.text}`);
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, 80);
  }

  stop(finalText = '', success = true) {
    clearInterval(this.interval);
    const symbol = success ? colors.green + symbols.check : colors.red + symbols.cross;
    process.stdout.write(`\r${symbol}${colors.reset} ${finalText || this.text}\n`);
  }

  update(text) {
    this.text = text;
  }
}

class StepDisplay {
  constructor() {
    this.steps = [];
    this.currentStep = -1;
  }

  setSteps(steps) {
    this.steps = steps.map(s => ({
      id: s.id,
      title: s.title,
      status: 'pending',
      duration: null,
      error: null
    }));
  }

  startStep(stepId) {
    this.currentStep = this.steps.findIndex(s => s.id === stepId);
    if (this.currentStep >= 0) {
      this.steps[this.currentStep].status = 'running';
      this.steps[this.currentStep].startTime = Date.now();
    }
    this.render();
  }

  completeStep(stepId, success = true, error = null) {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = success ? 'success' : 'error';
      step.duration = ((Date.now() - step.startTime) / 1000).toFixed(1);
      step.error = error;
    }
    this.render();
  }

  skipStep(stepId) {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'skipped';
    }
    this.render();
  }

  render() {
    if (this.steps.length > 0) {
      process.stdout.write(`${ESC}[${this.steps.length + 2}A`);
    }

    console.log('');
    for (const step of this.steps) {
      let statusIcon, statusColor;

      switch (step.status) {
        case 'success':
          statusIcon = symbols.success;
          statusColor = colors.green;
          break;
        case 'error':
          statusIcon = symbols.error;
          statusColor = colors.red;
          break;
        case 'running':
          statusIcon = symbols.running;
          statusColor = colors.cyan;
          break;
        case 'skipped':
          statusIcon = symbols.skip;
          statusColor = colors.dim;
          break;
        default:
          statusIcon = symbols.pending;
          statusColor = colors.dim;
      }

      const duration = step.duration ? ` ${colors.dim}(${step.duration}s)${colors.reset}` : '';
      console.log(`  ${statusIcon} ${statusColor}Step ${step.id}:${colors.reset} ${step.title}${duration}`);
    }
    console.log('');
  }
}

function formatBox(title, content, width = 60) {
  const lines = content.split('\n');
  const topBorder = '═'.repeat(width);
  const bottomBorder = '═'.repeat(width);

  let output = `${colors.cyan}╔${topBorder}╗${colors.reset}\n`;

  const titlePadding = Math.floor((width - title.length) / 2);
  output += `${colors.cyan}║${colors.reset}${' '.repeat(titlePadding)}${colors.bold}${title}${colors.reset}${' '.repeat(width - titlePadding - title.length)}${colors.cyan}║${colors.reset}\n`;
  output += `${colors.cyan}╠${topBorder}╣${colors.reset}\n`;

  for (const line of lines) {
    const paddedLine = line.slice(0, width - 2).padEnd(width - 2);
    output += `${colors.cyan}║${colors.reset} ${paddedLine}${colors.cyan}║${colors.reset}\n`;
  }

  output += `${colors.cyan}╚${bottomBorder}╝${colors.reset}`;

  return output;
}

function formatPlanSummary(plan) {
  let output = '';

  output += `\n${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`;
  output += `${colors.cyan}${' '.repeat(20)}EXECUTION PLAN${colors.reset}\n`;
  output += `${colors.cyan}${'═'.repeat(60)}${colors.reset}\n\n`;

  output += `${symbols.plan} Task: ${colors.bold}${plan.task}${colors.reset}\n`;
  output += `🤖 Executor: ${plan.model || 'Local LLM'}\n`;
  output += `📊 Steps: ${plan.steps.length}\n`;
  output += `💰 Est. savings: ~${(plan.estimatedTokensSaved || 0).toLocaleString()} tokens\n\n`;

  for (const step of plan.steps) {
    output += `${colors.dim}┌${'─'.repeat(58)}${colors.reset}\n`;
    output += `${colors.dim}│${colors.reset} ${colors.bold}Step ${step.id}:${colors.reset} ${step.title}\n`;
    output += `${colors.dim}│${colors.reset} Type: ${step.type}\n`;
    if (step.params?.path) {
      output += `${colors.dim}│${colors.reset} Path: ${colors.cyan}${step.params.path}${colors.reset}\n`;
    }
    const deps = step.dependsOn?.length > 0 ? `Steps ${step.dependsOn.join(', ')}` : 'None';
    output += `${colors.dim}│${colors.reset} Dependencies: ${deps}\n`;
  }
  output += `${colors.dim}└${'─'.repeat(58)}${colors.reset}\n`;

  return output;
}

function formatOptions(options) {
  let output = '\nHow would you like to proceed?\n\n';

  for (const opt of options) {
    output += `  ${colors.cyan}[${opt.key}]${colors.reset} ${opt.icon} ${opt.label}\n`;
  }

  return output + '\nYour choice: ';
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatResults(results) {
  let output = '';

  output += `\n${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`;
  output += `${colors.cyan}${' '.repeat(18)}EXECUTION SUMMARY${colors.reset}\n`;
  output += `${colors.cyan}${'═'.repeat(60)}${colors.reset}\n\n`;

  if (results.success) {
    output += `${symbols.success} ${colors.green}Plan executed successfully!${colors.reset}\n`;
  } else {
    output += `${symbols.error} ${colors.red}Plan execution failed${colors.reset}\n`;
  }

  const successCount = results.steps?.filter(s => s.success).length || 0;
  const totalCount = results.steps?.length || 0;

  output += `\nSteps completed: ${successCount}/${totalCount}\n`;
  output += `Tokens saved: ~${(results.tokensSaved || 0).toLocaleString()}\n`;

  if (results.escalateToCloud?.length > 0) {
    output += `\n${colors.yellow}${symbols.warning} Steps requiring escalation:${colors.reset}\n`;
    for (const step of results.escalateToCloud) {
      output += `  ${symbols.bullet} Step ${step.id}: ${step.title}\n`;
    }
  }

  output += `\n${colors.dim}Results saved to: .workflow/state/hybrid-results.json${colors.reset}\n`;

  return output;
}

module.exports = {
  colors,
  symbols,
  ProgressBar,
  Spinner,
  StepDisplay,
  formatBox,
  formatPlanSummary,
  formatOptions,
  formatResults,
  prompt
};

if (require.main === module) {
  const demo = async () => {
    console.log('\n=== Progress Display Demo ===\n');

    const spinner = new Spinner('Detecting providers...');
    spinner.start();
    await new Promise(r => setTimeout(r, 2000));
    spinner.stop('Providers detected', true);

    console.log('\nProgress bar:');
    const bar = new ProgressBar(10);
    for (let i = 0; i <= 10; i++) {
      bar.update(i, `Step ${i}/10`);
      await new Promise(r => setTimeout(r, 200));
    }
    bar.complete('All steps done');

    const plan = {
      task: 'Add user authentication',
      model: 'nemotron-3-nano',
      estimatedTokensSaved: 12000,
      steps: [
        { id: 1, type: 'create-service', title: 'Create authService', params: { path: 'src/services/authService.ts' }, dependsOn: [] },
        { id: 2, type: 'create-hook', title: 'Create useAuth hook', params: { path: 'src/hooks/useAuth.ts' }, dependsOn: [1] }
      ]
    };
    console.log(formatPlanSummary(plan));

    const options = [
      { key: '1', icon: '✅', label: 'Execute this plan' },
      { key: '2', icon: '✅', label: 'Execute, skip future reviews' },
      { key: '3', icon: '✏️', label: 'Modify something' },
      { key: '4', icon: '❌', label: 'Cancel' }
    ];
    console.log(formatOptions(options));
  };

  demo();
}
