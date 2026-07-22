# Research: "pi-coding-agent latest version 2026"

## Summary
As of late July 2026, the primary **Pi coding agent** — a minimal, extensible terminal-based AI coding harness — is published as `@earendil-works/pi-coding-agent` on npm at version **0.81.1**. The project was originally created by Mario Zechner and moved to the Earendil Works organization in May 2026 (first release under the new scope: v0.74.0). The GitHub monorepo (`earendil-works/pi`) has 248+ releases, with v0.81.1 being the latest. A separate, less actively maintained Python wrapper exists on PyPI as `pi-coding-agent` at version **0.6.0** (released June 12, 2026).

## Findings

1. **npm latest version: 0.81.1** — The official package `@earendil-works/pi-coding-agent` on npm reports latest version **0.81.1**, last published ~1 day ago (as of late July 2026), with 379 dependents. The companion packages `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` are also at 0.81.1. [Source](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

2. **GitHub latest release: v0.81.1** — The GitHub releases page shows **v0.81.1** as the latest release (tagged ~7 hours ago from the search date, around July 22, 2026). The 0.81.x series added llama.cpp support (0.81.0) and subsequent bug fixes including a crash fix when resuming sessions. [Source](https://github.com/earendil-works/pi/releases)

3. **Project migration and renaming** — Pi moved from `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent` in May 2026 with v0.74.0. The old package (`@mariozechner/pi-coding-agent`) remains at v0.73.1 and is no longer updated. Tutorials written before the rename may be broken. [Source](https://pi.dev/news/2026/5/7/pi-has-a-new-home)

4. **PyPI version lags significantly: 0.6.0** — The PyPI package `pi-coding-agent` shows the latest release as **0.6.0** (June 12, 2026). This appears to be a Python-based packaging/distribution that is not in sync with the primary npm releases. The README describes it as "A minimal, transparent AI coding agent — multi-provider, sandboxed, with a planner, sub-agents, skills, data analysis, and slide generation." [Source](https://pypi.org/project/pi-coding-agent/)

5. **Security: CVE-2026-54325 fixed in 0.79.0** — A vulnerability (CVE-2026-54325, GHSA-mqxh-6gq7-558m) was disclosed where Pi before version 0.79.0 loaded project-local `.pi` directory resources without first asking the user to trust that repository. Users are advised to upgrade to 0.79.0 or later. [Source](https://nvd.nist.gov/vuln/detail/CVE-2026-54325) | [dbugs](https://dbugs.ptsecurity.com/vulnerability/PT-2026-50492)

6. **Fork/extension: oh-my-pi at v15.10.0** — The community fork `can1357/oh-my-pi` extends Pi with hash-anchored edits, LSP integration, Python/Bun workers, sub-agents, and browser tooling. Its latest release is **v15.10.0**. [Source](https://github.com/can1357/oh-my-pi)

7. **Rust port: pi_agent_rust** — A Rust rewrite of Pi exists at `Dicklesworthstone/pi_agent_rust`, preserving the UX but changing the runtime from Node.js/TypeScript to Rust (zero unsafe code), with a size-optimized release profile. [Source](https://github.com/Dicklesworthstone/pi_agent_rust)

8. **Obsidian plugin and ecosystem compatibility** — The Obsidian Pi Agent plugin requires Pi coding agent **0.80.0 or newer** (last tested with 0.80.7). The `pi-web` Web UI requires Pi >=0.80.8 <0.81. This suggests 0.80.x is the broadly compatible stable line, with 0.81.x being the cutting edge. [Source](https://community.obsidian.md/plugins/pi-agent) | [Source](https://github.com/jmfederico/pi-web)

9. **Pi 0.81.0 key feature: llama.cpp support** — The 0.81.0 release added native llama.cpp integration, enabling local model support without external providers. This was confirmed in the Reddit r/LocalLLaMA community. [Source](https://www.reddit.com/r/LocalLLaMA/comments/1v2lszl/pi_0810_adds_support_for_llamacpp/) | [Changelog](https://pi.dev/news/releases)

10. **Version timeline** — The release cadence has been rapid:
    - v0.74.0 — May 7, 2026 (Earendil migration)
    - v0.79.0 — ~June 2026 (CVE fix)
    - v0.80.x — June-July 2026 (stable line)
    - v0.81.0 — ~July 21, 2026 (llama.cpp support)
    - v0.81.1 — ~July 22, 2026 (crash fix) [Composite from multiple sources]

## Sources

- **Kept:**
  - npm registry page for `@earendil-works/pi-coding-agent` (https://www.npmjs.com/package/@earendil-works/pi-coding-agent) — authoritative version source
  - GitHub Releases for `earendil-works/pi` (https://github.com/earendil-works/pi/releases) — primary release artifacts and changelogs
  - Pi official site news (https://pi.dev/news/releases) — official changelog
  - Pi blog: "Pi Has a New Home at Earendil" (https://pi.dev/news/2026/5/7/pi-has-a-new-home) — migration context
  - NVD CVE-2026-54325 (https://nvd.nist.gov/vuln/detail/CVE-2026-54325) — security advisory
  - PyPI pi-coding-agent (https://pypi.org/project/pi-coding-agent/) — Python distribution version
  - can1357/oh-my-pi GitHub (https://github.com/can1357/oh-my-pi) — major community fork
  - Pi extensions guide (https://www.aibuilderclub.com/blog/pi-agent-extensions-guide) — confirms 0.80.7 as "current"
  - Obsidian Pi Agent plugin (https://community.obsidian.md/plugins/pi-agent) — version compatibility reference
  - Reddit r/LocalLLaMA (https://www.reddit.com/r/LocalLLaMA/comments/1v2lszl/pi_0810_adds_support_for_llamacpp/) — 0.81.0 feature announcement

- **Dropped:**
  - Wink Mod 2026 / Temp Number — unrelated to pi-coding-agent
  - YouTube videos (comparisons, reviews) — secondary commentary, not version sources
  - Various fork repos with stale versions — not authoritative

## Gaps

1. **Exact 0.81.1 release date** — Multiple sources say "a day ago" / "7 hours ago" from the search date (~July 22, 2026), but the precise publication timestamp was not retrieved.
2. **PyPI vs npm discrepancy** — The PyPI package at 0.6.0 appears to be a different distribution channel with its own versioning. It is unclear whether this is an official Python wrapper or a third-party repackaging. The version gap (0.6.0 vs 0.81.1) is significant and unexplained.
3. **Node.js version requirements** — There is evidence of a Node 20 compatibility issue (issue #4876) that required a rescue release (v0.74.2 under `legacy-node20` dist-tag). The minimum Node.js version for current 0.81.x releases was not confirmed.
4. **Exact diff between 0.81.0 and 0.81.1** — Identified as a bug fix for a crash when resuming sessions (#6915), but a full changelog diff was not retrieved.

## Supervisor Coordination
None required — task completed autonomously with web-sourced data.
