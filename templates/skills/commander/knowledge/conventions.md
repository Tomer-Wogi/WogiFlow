# commander — Conventions

Naming and structural conventions for Commander.js CLIs.

---

- Use kebab-case for command names: `my-command`, not `myCommand`
- Use camelCase for option long names: `--output-dir` becomes `opts().outputDir`
- Place each subcommand in its own file under `commands/` or `lib/commands/`
- Use `.description()` on every command and option for auto-generated help
- Use `<required>` angle brackets for required args, `[optional]` square brackets for optional
- Use `.addHelpText('after', ...)` for examples in help output
- Exit with code 0 for success, 1 for user error, 2 for system error

---

_Customize these conventions based on your team's preferences._
