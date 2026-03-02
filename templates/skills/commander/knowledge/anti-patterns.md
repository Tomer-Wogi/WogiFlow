# commander — Anti-Patterns

Common mistakes to avoid when building CLIs with Commander.js.

---

## Forgetting parse()

**Problem**: Commander won't execute any commands without calling `.parse()`

**Fix**: Always call `program.parse()` or `program.parseAsync()` at the end

**Example**:
```
// Bad: commands are defined but never execute
program.command('start').action(() => { ... });
// Missing: program.parse();

// Good: always parse at the end
program.command('start').action(() => { ... });
program.parse();
```

---

## Sync Actions with Async Work

**Problem**: Using `.action()` with async callbacks without `parseAsync()`

**Fix**: Use `program.parseAsync()` when any action is async

**Example**:
```
// Bad: unhandled promise rejection
program.command('deploy').action(async () => {
  await deploy();
});
program.parse();

// Good: use parseAsync for async actions
program.command('deploy').action(async () => {
  await deploy();
});
await program.parseAsync();
```

---

## Global Options After Subcommands

**Problem**: Defining global options that subcommands can't access

**Fix**: Use `program.opts()` in subcommand actions, or pass options through

**Example**:
```
// Bad: subcommand can't see parent options
program.option('-v, --verbose');
program.command('build').action((options) => {
  // options.verbose is undefined here
});

// Good: access parent options explicitly
program.option('-v, --verbose');
program.command('build').action((options, cmd) => {
  const globalOpts = cmd.parent.opts();
  if (globalOpts.verbose) console.log('Verbose mode');
});
```

---
