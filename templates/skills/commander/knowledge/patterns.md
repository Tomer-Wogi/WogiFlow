# commander — Successful Patterns

Best practices for building CLIs with Commander.js.

---

## Subcommand Architecture

**Context**: Building a CLI with multiple commands

**Example**:
```
const { Command } = require('commander');
const program = new Command();

program
  .name('mycli')
  .description('My CLI tool')
  .version('1.0.0');

program.command('init')
  .description('Initialize a new project')
  .argument('[dir]', 'target directory', '.')
  .option('-t, --template <name>', 'project template')
  .action((dir, options) => {
    console.log(`Initializing in ${dir} with template ${options.template}`);
  });

program.parse();
```

**Why it works**: Each command is self-contained with its own options and arguments, keeping the CLI maintainable as it grows

---

## Option Processing with Defaults

**Context**: Defining options with type coercion and defaults

**Example**:
```
program
  .option('-p, --port <number>', 'server port', parseInt, 3000)
  .option('-v, --verbose', 'enable verbose logging', false)
  .option('--no-color', 'disable colored output')
  .requiredOption('-c, --config <path>', 'config file path');
```

**Why it works**: Commander handles type coercion, defaults, boolean flags, and negatable options out of the box

---

## Error Handling and Exit Codes

**Context**: Providing clear error messages and proper exit codes

**Example**:
```
program
  .exitOverride() // Throw instead of process.exit
  .configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
    outputError: (str, write) => write(`Error: ${str}`)
  });

program.command('deploy')
  .action(async () => {
    try {
      await deploy();
    } catch (err) {
      console.error(`Deploy failed: ${err.message}`);
      process.exit(1);
    }
  });
```

**Why it works**: Separating stdout/stderr, using exit codes, and catching async errors makes CLIs composable in shell pipelines

---
