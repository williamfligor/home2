# Research: pi-subagents npm package documentation

## Summary
`pi-subagents` is a community-maintained Pi Coding Agent extension (npm package, latest version 0.35.1+) that lets Pi delegate tasks to isolated, specialized child agents (subagents). It ships with 6 built-in agents (researcher, scout, planner, worker, reviewer, context-builder), supports parallel/chain execution, mid-run steering, and session resume. The primary author is **Nico Bailon** (`nicobailon/pi-subagents` on GitHub). Several forks and derivative packages exist, including `@tintinweb/pi-subagents`, `@gotgenes/pi-subagents`, and `@pi-vault/pi-subagents`.

## Findings

1. **Installation** — One command is all that's needed: `pi install npm:pi-subagents`. No manual configuration, agent creation, or slash-command learning is required. After installing, users delegate to subagents via plain-language prompts (e.g., "Use reviewer to review this diff"). [Source](https://github.com/nicobailon/pi-subagents)

2. **Built-in agents (6 out of the box)** — researcher, scout, planner, worker, reviewer, and context-builder. Rule of thumb: use scout before understanding the code, researcher before trusting external facts, planner before bigger changes, worker for implementation, reviewer for checking, and oracle/context-builder for risky decisions. [Source](https://pi.dev/packages/pi-subagents) · [Source](https://x.com/nicopreme/status/2023963317304520905)

3. **Agent configuration via Markdown frontmatter** — Agents are defined in `.pi/agents/{name}.md` files with YAML frontmatter. Each agent can specify: `model`, `thinking` level, `max_turns`, `tools` (allow/deny), `mcp` servers, `skills`, `inherit_context`, `run_in_background`, `isolated`, and more. Frontmatter is authoritative over defaults. [Source](https://deepwiki.com/nicobailon/pi-subagents/3.1-agents-and-agent-discovery) · [Source](https://pi.dev/packages/@tintinweb/pi-subagents)

4. **Execution modes** — Subagents can run in the foreground (synchronous), asynchronously in the background, chained sequentially (output of one feeds the next), or in parallel (multiple agents at once). Background agents report results as styled notification boxes. [Source](https://github.com/nicobailon/pi-subagents) · [Source](https://github.com/tintinweb/pi-subagents)

5. **Mid-run steering & session resume** — You can inject messages into running agents to redirect their work without restarting. Sessions can also be resumed, preserving full conversation context from where they left off. [Source](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents)

6. **Intercom bridge** — When `pi-intercom` is also installed, child agents get a private coordination channel back to the parent session, enabling them to ask for decisions instead of guessing. [Source](https://www.npmjs.com/package/pi-subagents?activeTab=readme) · [Source](https://github.com/DarkoKuzmanovic/pi-subagents)

7. **Model scope enforcement** — Optional validation that subagent model choices stay within the user's `enabledModels` allowlist (sourced from `/scoped-models`). Caller-supplied out-of-scope models trigger a hard error; frontmatter-pinned out-of-scope models warn but still run. Configurable via `/agents → Settings → Scope models`. [Source](https://github.com/tintinweb/pi-subagents)

8. **Event bus** — Lifecycle events (`subagents:created`, `started`, `completed`, `failed`, `steered`, `compacted`) are emitted via `pi.events`, enabling other extensions to react to sub-agent activity programmatically. [Source](https://github.com/gotgenes/pi-subagents)

9. **Key forks & derivatives:**
   - `nicobailon/pi-subagents` — original, async delegation with truncation, artifacts, session sharing
   - `tintinweb/pi-subagents` — Claude Code-style subagents with live widget, custom agent types, mid-run steering
   - `@gotgenes/pi-subagents` — focused in-process sub-agent core with typed API and lifecycle events
   - `@pi-vault/pi-subagents` — bundled agents, foreground/background/chains
   - `@ifi/pi-extension-subagents` — full-featured orchestration built on top of nicobailon
   - `pi-subagents-lite` — schema-first, zero-fluff, minimal token cost variant

10. **npm registry data** — Published on npm as `pi-subagents`, latest version 0.35.1 (4 days ago as of search date), with 24+ dependent projects. [Source](https://www.npmjs.com/package/pi-subagents)

## Sources

- **Kept:**
  - npm registry page (https://www.npmjs.com/package/pi-subagents) — authoritative package metadata
  - nicobailon/pi-subagents GitHub (https://github.com/nicobailon/pi-subagents) — primary source repo and README
  - tintinweb/pi-subagents GitHub (https://github.com/tintinweb/pi-subagents) — major fork with extensive docs
  - DeepWiki: Agents and Agent Discovery (https://deepwiki.com/nicobailon/pi-subagents/3.1-agents-and-agent-discovery) — detailed agent configuration docs
  - Pi.dev package catalog (https://pi.dev/packages/pi-subagents) — official Pi package listing with descriptions
  - pi-vault/pi-subagents (https://github.com/pi-vault/pi-subagents/) — another notable fork with bundled agents

- **Dropped:**
  - Reddit threads — commentary rather than documentation
  - X/Twitter posts — announcements, not structured docs
  - jsDelivr CDN page — package distribution, not docs
  - Blog posts (bitdoze, nikiforovall, axbrief) — secondary/opinion content

## Gaps

- **Official Pi documentation** — No formal "pi-subagents" section was found on a Pi-maintained docs site. The package is community-maintained.
- **Version-specific changelog** — Could not retrieve the full changelog/NEWS for the latest 0.35.x versions.
- **API reference** — The typed API (event bus, RPC) is mentioned but not exhaustively documented in search results; deeper inspection of source would be needed.
- **Compatibility matrix** — Unclear which versions of the Pi Coding Agent core are required for specific pi-subagents versions.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned 10 concrete findings with specific file paths (.pi/agents/{name}.md), package names, npm version numbers, and severity distinctions (hard error vs warning for model scope)."
    }
  ],
  "changedFiles": [
    "/home/will/.local/share/chezmoi/.pi-subagents/artifacts/outputs/b90a3123/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Research brief written to specified output path with 10 findings, source citations, gaps analysis, and acceptance report."
  ],
  "residualRisks": [
    "Community-maintained package with multiple forks; documentation may diverge between forks. Version-specific details limited without reading full source."
  ],
  "noStagedFiles": true,
  "diffSummary": "Created research.md with 10 findings on pi-subagents npm package covering installation, built-in agents, frontmatter configuration, execution modes, mid-run steering, intercom bridge, model scope enforcement, event bus, forks, and registry metadata.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Package is community-maintained (nicobailon primary author), not officially documented on a Pi-maintained site. Multiple active forks exist with varying feature sets."
}
```
