Research complete. The file has been written to the specified output path. Key findings:

- **`pi-subagents`** is a community Pi extension (npm, v0.35.1+) by Nico Bailon that enables task delegation to specialized child agents.
- **One-command install**: `pi install npm:pi-subagents`
- **6 built-in agents**: researcher, scout, planner, worker, reviewer, context-builder
- **Execution**: foreground, background (async), chains, or parallel
- **Configuration**: YAML frontmatter in `.pi/agents/{name}.md` files
- **Advanced features**: mid-run steering, session resume, intercom bridge for child→parent communication, model scope enforcement, event bus
- **Multiple active forks**: tintinweb, gotgenes, pi-vault, ifi, and pi-subagents-lite