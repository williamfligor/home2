// ----------------------------------------------------------------------------
// Source:  https://github.com/carderne/pi-sandbox
// Origin:  https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/sandbox/index.ts
// Based on the original sandbox example by Mario Zechner (pi-mono, MIT).
// Extended with tool-call path guards, interactive permission prompts, and
// allowlist persistence by Chris Arderne (pi-sandbox, MIT).
//
// SPDX-FileCopyrightText: Mario Zechner, Chris Arderne
// SPDX-License-Identifier: MIT
// ----------------------------------------------------------------------------
/**
 * Sandbox Extension - OS-level sandboxing for bash commands, plus path policy
 * enforcement for pi's read/write/edit/grep/find/ls tools, with interactive
 * permission prompts.
 *
 * Uses @anthropic-ai/sandbox-runtime to enforce filesystem and network
 * restrictions on bash commands at the OS level (sandbox-exec on macOS,
 * bubblewrap on Linux). Also intercepts the read, write, edit, grep, find,
 * and ls tools to apply the same filesystem rules, which OS-level sandboxing
 * cannot cover (those tools run directly in Node.js, not in a subprocess).
 *
 * When a block is triggered, the user is prompted to:
 *   (a) Abort (keep blocked)
 *   (b) Allow for this session only  — stored in memory, agent cannot access
 *   (c) Allow for this project       — written to .pi/sandbox.json
 *   (d) Allow for all projects       — written to ~/.pi/agent/sandbox.json
 *
 * What gets prompted vs. hard-blocked:
 *   - domains: prompted if not whitelisted nor explicitly denied
 *   - write: prompted if not whitelisted nor explicitly denied
 *   - read: always prompted (because denyRead is used for broad block, may want to punch holes)
 *
 * IMPORTANT — precedence for read:
 *   Read:  allowRead OVERRIDES denyRead (prompt grant adds to allowRead)
 *   Write: denyWrite OVERRIDES allowWrite (most-specific deny wins)
 *
 * Config files (merged, project takes precedence):
 * - ~/.pi/agent/sandbox.json (global)
 * - <cwd>/.pi/sandbox.json  (project-local)
 *
 * Example .pi/sandbox.json:
 * ```json
 * {
 *   "enabled": true,
 *   "network": {
 *     "allowedDomains": ["github.com", "*.github.com"],
 *     "deniedDomains": []
 *   },
 *   "filesystem": {
 *     "denyRead": ["/Users", "/home"],
 *     "allowRead": [".", "~/.config", "~/.local", "Library"],
 *     "allowWrite": [".", "/tmp"],
 *     "denyWrite": [".env"]
 *   }
 * }
 * ```
 *
 * Commands:
 *   /sandbox       - Show current sandbox configuration
 *   /sandbox on    - Enable sandboxing for this session
 *   /sandbox off   - Disable sandboxing for this session
 *
 * Flags:
 *   --no-sandbox   - Disable sandboxing at startup
 *
 * Setup:
 * 1. Copy sandbox/ directory to ~/.pi/agent/extensions/
 * 2. Run `npm install` in ~/.pi/agent/extensions/sandbox/
 *
 * Linux also requires: bubblewrap, socat, ripgrep
 */

import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  SandboxManager,
  type SandboxAskCallback,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import {
  type BashOperations,
  createBashToolDefinition,
  getAgentDir,
  getShellConfig,
  isToolCallEventType,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";

interface SandboxConfig extends SandboxRuntimeConfig {
  enabled?: boolean;
}

const DEFAULT_CONFIG: SandboxConfig = {
  enabled: true,
  network: {
    allowedDomains: [
      "npmjs.org",
      "*.npmjs.org",
      "registry.npmjs.org",
      "registry.yarnpkg.com",
      "pypi.org",
      "*.pypi.org",
      "github.com",
      "*.github.com",
      "api.github.com",
      "raw.githubusercontent.com",
    ],
    deniedDomains: [],
    allowAllUnixSockets: true,
  },
  filesystem: {
    denyRead: ["/Users", "/home"],
    allowRead: ["~/.config", "~/.local", "Library"],
    allowWrite: [".", "/tmp"],
    denyWrite: [".env", ".env.*", "*.pem", "*.key"],
  },
};

function loadConfig(cwd: string): SandboxConfig {
  const projectConfigPath = join(cwd, ".pi", "sandbox.json");
  const globalConfigPath = join(getAgentDir(), "sandbox.json");

  let globalConfig: Partial<SandboxConfig> = {};
  let projectConfig: Partial<SandboxConfig> = {};

  if (existsSync(globalConfigPath)) {
    try {
      globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
    } catch (e) {
      console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
    }
  }

  if (existsSync(projectConfigPath)) {
    try {
      projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
    } catch (e) {
      console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
    }
  }

  const config = deepMerge(deepMerge(DEFAULT_CONFIG, globalConfig), projectConfig);

  // Normalize allowRead: remove entries that are ancestors of allowWrite paths.
  // When allowRead is an ancestor (e.g., "~/.local") and allowWrite is a child
  // (e.g., ".", resolved to ~/.local/share/chezmoi), the sandbox runtime's
  // mount ordering puts --ro-bind for allowRead after --bind for allowWrite,
  // causing the ro-bind to shadow the write bind. Skip these entries since
  // write implies read for child paths anyway — the tool-level read policy
  // check falls back to effectiveAllowWrite to enforce this.
  if (config.filesystem?.allowRead && config.filesystem?.allowWrite) {
    config.filesystem.allowRead = normalizeAllowRead(
      config.filesystem.allowRead,
      config.filesystem.allowWrite,
      cwd,
    );
  }

  return config;
}

/**
 * Normalize allowRead paths, removing entries that would shadow allowWrite
 * paths due to mount ordering in the sandbox runtime's bwrap command.
 */
function normalizeAllowRead(
  allowRead: string[],
  allowWrite: string[],
  cwd: string,
): string[] {
  const normalize = (p: string): string => {
    if (p.startsWith("~/")) return join(homedir(), p.slice(2));
    if (p === "~") return homedir();
    return resolve(cwd, p);
  };

  const normalizedWrite = allowWrite.map(normalize);

  return allowRead.filter((rawPath) => {
    const normalized = normalize(rawPath);

    const conflicts = normalizedWrite.some((writePath) => {
      // Check if normalized is the same as or an ancestor of writePath
      return writePath === normalized || writePath.startsWith(normalized + "/");
    });

    if (conflicts) {
      const match = normalizedWrite.find(
        (w) => w === normalized || w.startsWith(normalized + "/"),
      );
      console.debug(
        `[Sandbox] Removing allowRead "${rawPath}" → ${normalized}: would shadow allowWrite path "${match}"`,
      );
      return false;
    }
    return true;
  });
}

function deepMerge(base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig {
  const result: SandboxConfig = { ...base };

  if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
  if (overrides.network) {
    const net = { ...base.network };
    const onet = overrides.network;
    if (onet.allowedDomains !== undefined) net.allowedDomains = onet.allowedDomains;
    if (onet.deniedDomains !== undefined) net.deniedDomains = onet.deniedDomains;
    if (onet.parentProxy !== undefined) net.parentProxy = onet.parentProxy;
    result.network = net;
  }
  if (overrides.filesystem) {
    // Only override individual filesystem keys that are actually specified
    // (non-undefined). Empty arrays must not clobber base defaults.
    const fs = { ...base.filesystem };
    const ofs = overrides.filesystem;
    if (ofs.allowRead !== undefined) fs.allowRead = ofs.allowRead;
    if (ofs.denyRead !== undefined) fs.denyRead = ofs.denyRead;
    if (ofs.allowWrite !== undefined) fs.allowWrite = ofs.allowWrite;
    if (ofs.denyWrite !== undefined) fs.denyWrite = ofs.denyWrite;
    result.filesystem = fs;
  }

  const extOverrides = overrides as {
    ignoreViolations?: Record<string, string[]>;
    enableWeakerNestedSandbox?: boolean;
    allowBrowserProcess?: boolean;
  };
  const extResult = result as {
    ignoreViolations?: Record<string, string[]>;
    enableWeakerNestedSandbox?: boolean;
    allowBrowserProcess?: boolean;
  };

  if (extOverrides.ignoreViolations) {
    extResult.ignoreViolations = extOverrides.ignoreViolations;
  }
  if (extOverrides.enableWeakerNestedSandbox !== undefined) {
    extResult.enableWeakerNestedSandbox = extOverrides.enableWeakerNestedSandbox;
  }
  if (extOverrides.allowBrowserProcess !== undefined) {
    extResult.allowBrowserProcess = extOverrides.allowBrowserProcess;
  }

  return result;
}

// ── Domain helpers ────────────────────────────────────────────────────────────

export function shouldPromptForWrite(
  path: string,
  allowWrite: string[],
  matchesPattern: (path: string, patterns: string[]) => boolean,
): boolean {
  // Secure default: empty allowWrite means deny-all writes (prompt every path).
  return allowWrite.length === 0 || !matchesPattern(path, allowWrite);
}

function extractDomainsFromCommand(command: string): string[] {
  const urlRegex = /https?:\/\/([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const domains = new Set<string>();
  let match;
  while ((match = urlRegex.exec(command)) !== null) {
    domains.add(match[1]);
  }
  return [...domains];
}

function domainMatchesPattern(domain: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return domain === base || domain.endsWith("." + base);
  }
  return domain === pattern;
}

function allowsAllDomains(allowedDomains: string[] | undefined): boolean {
  return allowedDomains?.includes("*") ?? false;
}

function domainIsAllowed(domain: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((p) => domainMatchesPattern(domain, p));
}

function createNetworkAskCallback(allowedDomains: string[]): SandboxAskCallback {
  return async ({ host }) => domainIsAllowed(host, allowedDomains);
}

// ── Output analysis ───────────────────────────────────────────────────────────

/** Extract a path from a bash "Operation not permitted" OS sandbox error. */
function extractBlockedWritePath(output: string): string | null {
  const match = output.match(
    /(?:\/bin\/bash|bash|sh): (?:line \d: )?(\/[^\s:]+): Operation not permitted/,
  );
  return match ? match[1] : null;
}

// ── Path pattern matching ─────────────────────────────────────────────────────

function expandPath(filePath: string): string {
  const expanded = filePath.replace(/^~(?=$|\/)/, homedir());
  return resolve(expanded);
}

function canonicalizePath(filePath: string): string {
  const abs = expandPath(filePath);
  try {
    return realpathSync.native(abs);
  } catch {
    // For writes to paths that do not exist yet, resolve symlinks in the nearest
    // existing parent directory, then append the non-existent tail.
    const tail: string[] = [];
    let probe = abs;
    while (!existsSync(probe)) {
      const parent = dirname(probe);
      if (parent === probe) return abs;
      tail.unshift(basename(probe));
      probe = parent;
    }
    try {
      return resolve(realpathSync.native(probe), ...tail);
    } catch {
      return abs;
    }
  }
}

function matchesPattern(filePath: string, patterns: string[]): boolean {
  const abs = canonicalizePath(filePath);
  return patterns.some((p) => {
    const absP = p.includes("*") ? expandPath(p) : canonicalizePath(p);
    if (p.includes("*")) {
      const escaped = absP.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`).test(abs);
    }
    const sep = absP.endsWith("/") ? "" : "/";
    return abs === absP || abs.startsWith(absP + sep);
  });
}

// ── Config file updaters (Node.js process — not OS-sandboxed) ─────────────────

function getConfigPaths(cwd: string): {
  globalPath: string;
  projectPath: string;
} {
  return {
    globalPath: join(homedir(), ".pi", "agent", "sandbox.json"),
    projectPath: join(cwd, ".pi", "sandbox.json"),
  };
}

function readOrEmptyConfig(configPath: string): Partial<SandboxConfig> {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function writeConfigFile(configPath: string, config: Partial<SandboxConfig>): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function addDomainToConfig(configPath: string, domain: string): void {
  const config = readOrEmptyConfig(configPath);
  const existing = config.network?.allowedDomains ?? [];
  if (!existing.includes(domain)) {
    config.network = {
      ...config.network,
      allowedDomains: [...existing, domain],
    };
    writeConfigFile(configPath, config);
  }
}

function addReadPathToConfig(configPath: string, pathToAdd: string): void {
  const config = readOrEmptyConfig(configPath);
  const existing = config.filesystem?.allowRead ?? [];
  if (!existing.includes(pathToAdd)) {
    config.filesystem = {
      ...config.filesystem,
      allowRead: [...existing, pathToAdd],
    };
    writeConfigFile(configPath, config);
  }
}

function addWritePathToConfig(configPath: string, pathToAdd: string): void {
  const config = readOrEmptyConfig(configPath);
  const existing = config.filesystem?.allowWrite ?? [];
  if (!existing.includes(pathToAdd)) {
    config.filesystem = {
      ...config.filesystem,
      allowWrite: [...existing, pathToAdd],
    };
    writeConfigFile(configPath, config);
  }
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerFlag("no-sandbox", {
    description: "Disable OS-level sandboxing for bash commands",
    type: "boolean",
    default: false,
  });

  const localCwd = process.cwd();
  const userShellPath = SettingsManager.create(localCwd).getShellPath();
  const localBash = createBashToolDefinition(localCwd, { shellPath: userShellPath });

  let sandboxEnabled = false;
  let sandboxInitialized = false;

  // Session-temporary allowances — held in JS memory, not accessible by the agent.
  // These are added on top of whatever is in the config files.
  const sessionAllowedDomains: string[] = [];
  const sessionAllowedReadPaths: string[] = [];
  const sessionAllowedWritePaths: string[] = [];

  // ── Sandboxed bash ops ──────────────────────────────────────────────────────

  function createSandboxedBashOps(shellPath?: string, cwd?: string): BashOperations {
    return {
      async exec(command, execCwd, { onData, signal, timeout, env }) {
        if (!existsSync(execCwd)) {
          throw new Error(`Working directory does not exist: ${execCwd}`);
        }

        const { shell, args } = getShellConfig(shellPath);

        // Build the effective sandbox config and pass it explicitly so
        // wrapWithSandbox picks up the right allowWrite/denyRead rules
        // even when called from forked (subagent) sessions.
        const resolveCwd = cwd ?? execCwd;
        const baseConfig = loadConfig(resolveCwd);
        const customConfig = {
          network: {
            ...baseConfig.network,
            allowedDomains: [
              ...(baseConfig.network?.allowedDomains ?? []),
              ...sessionAllowedDomains,
            ],
          },
          filesystem: {
            ...baseConfig.filesystem,
            allowRead: [
              ...(baseConfig.filesystem?.allowRead ?? []),
              ...sessionAllowedReadPaths,
            ],
            allowWrite: [
              ...(baseConfig.filesystem?.allowWrite ?? []),
              ...sessionAllowedWritePaths,
            ],
          },
        };

        const wrappedCommand = await SandboxManager.wrapWithSandbox(
          command, shell, customConfig,
        );

        return new Promise((resolve, reject) => {
          const child = spawn(shell, [...args, wrappedCommand], {
            cwd: execCwd,
            env,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });

          let timedOut = false;
          let timeoutHandle: NodeJS.Timeout | undefined;

          if (timeout !== undefined && timeout > 0) {
            timeoutHandle = setTimeout(() => {
              timedOut = true;
              if (child.pid) {
                try {
                  process.kill(-child.pid, "SIGKILL");
                } catch {
                  child.kill("SIGKILL");
                }
              }
            }, timeout * 1000);
          }

          child.stdout?.on("data", onData);
          child.stderr?.on("data", onData);

          child.on("error", (err) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            reject(err);
          });

          const onAbort = () => {
            if (child.pid) {
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {
                child.kill("SIGKILL");
              }
            }
          };

          signal?.addEventListener("abort", onAbort, { once: true });

          child.on("close", (code) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            signal?.removeEventListener("abort", onAbort);

            // Clean up bwrap mount point files created on Linux
            SandboxManager.cleanupAfterCommand();

            if (signal?.aborted) {
              reject(new Error("aborted"));
            } else if (timedOut) {
              reject(new Error(`timeout:${timeout}`));
            } else {
              resolve({ exitCode: code });
            }
          });
        });
      },
    };
  }

  // ── Helper: update status line ──────────────────────────────────────────────

  function updateStatus(ctx: ExtensionContext) {
    if (sandboxEnabled) {
      ctx.ui.setStatus("sandbox", ctx.ui.theme.fg("accent", "\udb80\udf3e"));
    } else {
      ctx.ui.setStatus("sandbox", ctx.ui.theme.fg("accent", "\udb85\ude71"));
    }
  }

  // ── Effective config helpers ────────────────────────────────────────────────

  function getEffectiveAllowedDomains(cwd: string): string[] {
    const config = loadConfig(cwd);
    return [...(config.network?.allowedDomains ?? []), ...sessionAllowedDomains];
  }

  function getEffectiveAllowRead(cwd: string): string[] {
    const config = loadConfig(cwd);
    return [...(config.filesystem?.allowRead ?? []), ...sessionAllowedReadPaths];
  }

  function getEffectiveAllowWrite(cwd: string): string[] {
    const config = loadConfig(cwd);
    return [...(config.filesystem?.allowWrite ?? []), ...sessionAllowedWritePaths];
  }

  // ── Sandbox reinitialize ────────────────────────────────────────────────────
  // Called after granting a session/permanent allowance so the OS-level sandbox
  // picks up the new rules before the next bash subprocess starts.

  async function reinitializeSandbox(cwd: string): Promise<void> {
    if (!sandboxInitialized) return;
    const config = loadConfig(cwd);
    const configExt = config as unknown as { allowBrowserProcess?: boolean };
    try {
      const network = {
        ...config.network,
        allowedDomains: [...(config.network?.allowedDomains ?? []), ...sessionAllowedDomains],
        deniedDomains: config.network?.deniedDomains ?? [],
      };
      await SandboxManager.reset();
      await SandboxManager.initialize(
        {
          network,
          filesystem: {
            ...config.filesystem,
            denyRead: config.filesystem?.denyRead ?? [],
            allowRead: [...(config.filesystem?.allowRead ?? []), ...sessionAllowedReadPaths],
            allowWrite: [...(config.filesystem?.allowWrite ?? []), ...sessionAllowedWritePaths],
            denyWrite: config.filesystem?.denyWrite ?? [],
          },
          allowBrowserProcess: configExt.allowBrowserProcess,
          enableWeakerNetworkIsolation: true,
        },
        createNetworkAskCallback(network.allowedDomains),
      );
    } catch (e) {
      console.error(`Warning: Failed to reinitialize sandbox: ${e}`);
    }
  }

  // ── UI prompts ──────────────────────────────────────────────────────────────

  interface PromptOption {
    label: string;
    key: string;
    action: "abort" | "session" | "project" | "global";
    confirm?: boolean;
    hint?: string;
  }

  const PERMISSION_OPTIONS: PromptOption[] = [
    { label: "Allow for this session only", key: "s", action: "session" },
    { label: "Abort (keep blocked)", key: "esc", action: "abort" },
    {
      label: "Allow for this project",
      key: "P",
      action: "project",
      confirm: true,
      hint: "→ .pi/sandbox.json",
    },
    {
      label: "Allow for all projects",
      key: "A",
      action: "global",
      confirm: true,
      hint: "→ ~/.pi/agent/sandbox.json",
    },
  ];

  async function showPermissionPrompt(
    ctx: ExtensionContext,
    title: string,
    options: PromptOption[],
  ): Promise<"abort" | "session" | "project" | "global"> {
    if (!ctx.hasUI) return "abort";

    const result = await ctx.ui.custom<"abort" | "session" | "project" | "global">(
      (tui, theme, _kb, done) => {
        let selectedIndex = 0;
        let pendingAction: "abort" | "session" | "project" | "global" | null = null;

        function resolve(action: "abort" | "session" | "project" | "global") {
          done(action);
        }

        return {
          render(width: number): string[] {
            const lines: string[] = [];
            lines.push(truncateToWidth(theme.fg("warning", title), width));
            lines.push("");

            for (let i = 0; i < options.length; i++) {
              const opt = options[i];
              const isSelected = i === selectedIndex;
              const isPending = pendingAction === opt.action;

              const prefix = isSelected ? " → " : "   ";
              const keyHint = theme.fg("accent", `[${opt.key}]`);
              let label = opt.label;

              if (opt.hint) {
                label += `  ${theme.fg("dim", opt.hint)}`;
              }

              if (isPending) {
                label += `  ${theme.fg("warning", "→ press Enter to confirm")}`;
              }

              const line = `${prefix}${keyHint} ${label}`;
              lines.push(truncateToWidth(line, width));
            }

            lines.push("");
            const footer = pendingAction
              ? "↑↓ navigate  enter confirm  esc cancel"
              : "↑↓ navigate  enter select  esc/ctrl+c cancel";
            lines.push(truncateToWidth(theme.fg("dim", footer), width));

            return lines;
          },

          handleInput(data: string): void {
            if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
              resolve("abort");
              return;
            }

            if (matchesKey(data, Key.enter)) {
              if (pendingAction) {
                resolve(pendingAction);
              } else {
                resolve(options[selectedIndex]?.action ?? "abort");
              }
              return;
            }

            if (matchesKey(data, Key.up)) {
              selectedIndex = Math.max(0, selectedIndex - 1);
              pendingAction = null;
              tui.requestRender();
              return;
            }
            if (matchesKey(data, Key.down)) {
              selectedIndex = Math.min(options.length - 1, selectedIndex + 1);
              pendingAction = null;
              tui.requestRender();
              return;
            }

            for (let i = 0; i < options.length; i++) {
              const opt = options[i];
              if (data === opt.key) {
                // Exact case match (uppercase P/A) → immediate
                resolve(opt.action);
                return;
              }
              if (data.toLowerCase() === opt.key.toLowerCase()) {
                // Lowercase match → confirmation required for P/A
                if (opt.confirm) {
                  pendingAction = opt.action;
                  selectedIndex = i;
                } else {
                  resolve(opt.action);
                }
                tui.requestRender();
                return;
              }
            }
          },

          invalidate(): void {
            // no-op
          },
        };
      },
    );

    return result ?? "abort";
  }

  async function promptDomainBlock(
    ctx: ExtensionContext,
    domain: string,
  ): Promise<"abort" | "session" | "project" | "global"> {
    return showPermissionPrompt(
      ctx,
      `🌐 Network blocked: "${domain}" is not in allowedDomains`,
      PERMISSION_OPTIONS,
    );
  }

  async function promptReadBlock(
    ctx: ExtensionContext,
    filePath: string,
  ): Promise<"abort" | "session" | "project" | "global"> {
    return showPermissionPrompt(
      ctx,
      `📖 Read blocked: "${filePath}" is not in allowRead`,
      PERMISSION_OPTIONS,
    );
  }

  async function promptWriteBlock(
    ctx: ExtensionContext,
    filePath: string,
  ): Promise<"abort" | "session" | "project" | "global"> {
    return showPermissionPrompt(
      ctx,
      `📝 Write blocked: "${filePath}" is not in allowWrite`,
      PERMISSION_OPTIONS,
    );
  }

  function warnIfAllDomainsAllowed(ctx: ExtensionContext, config: SandboxConfig): void {
    if (!allowsAllDomains(config.network?.allowedDomains)) return;
    ctx.ui.notify(
      '⚠️ Network sandbox allows all domains because network.allowedDomains contains "*". ' +
        'Only use this intentionally; remove "*" to restore per-domain prompts.',
      "warning",
    );
  }

  // ── Apply allowance choices ─────────────────────────────────────────────────

  async function applyDomainChoice(
    choice: "session" | "project" | "global",
    domain: string,
    cwd: string,
  ): Promise<void> {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    if (!sessionAllowedDomains.includes(domain)) sessionAllowedDomains.push(domain);
    if (choice === "project") addDomainToConfig(projectPath, domain);
    if (choice === "global") addDomainToConfig(globalPath, domain);
    await reinitializeSandbox(cwd);
  }

  async function applyReadChoice(
    choice: "session" | "project" | "global",
    filePath: string,
    cwd: string,
  ): Promise<void> {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    if (!sessionAllowedReadPaths.includes(filePath)) sessionAllowedReadPaths.push(filePath);
    if (choice === "project") addReadPathToConfig(projectPath, filePath);
    if (choice === "global") addReadPathToConfig(globalPath, filePath);
    await reinitializeSandbox(cwd);
  }

  async function applyWriteChoice(
    choice: "session" | "project" | "global",
    filePath: string,
    cwd: string,
  ): Promise<void> {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    if (!sessionAllowedWritePaths.includes(filePath)) sessionAllowedWritePaths.push(filePath);
    if (choice === "project") addWritePathToConfig(projectPath, filePath);
    if (choice === "global") addWritePathToConfig(globalPath, filePath);
    await reinitializeSandbox(cwd);
  }

  // ── Bash tool — with write-block detection and retry ───────────────────────

  pi.registerTool({
    ...localBash,
    label: "bash (sandboxed)",
    async execute(id, params, signal, onUpdate, ctx) {
      const runBash = () => {
        if (!sandboxEnabled || !sandboxInitialized) {
          return localBash.execute(id, params, signal, onUpdate, ctx);
        }
        const sandboxedBash = createBashToolDefinition(localCwd, {
          operations: createSandboxedBashOps(userShellPath, localCwd),
          shellPath: userShellPath,
        });
        return sandboxedBash.execute(id, params, signal, onUpdate, ctx);
      };

      let result: AgentToolResult<any>;
      try {
        result = await runBash();
      } catch (e) {
        if (!(e instanceof Error)) throw e;
        if (!e.message.includes("Operation not permitted")) throw e;

        result = {
          content: [
            {
              type: "text",
              text: `Error: Command failed with OS-level sandbox restriction: ${e.message}`,
            },
          ],
          details: {},
        };
      }

      // Post-execution: detect OS-level write block and offer to allow.
      if (sandboxEnabled && sandboxInitialized && ctx?.hasUI) {
        const outputText = result.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");

        const blockedPath = extractBlockedWritePath(outputText);
        if (blockedPath) {
          const choice = await promptWriteBlock(ctx, blockedPath);
          if (choice !== "abort") {
            await applyWriteChoice(choice, blockedPath, ctx.cwd);

            // Check if denyWrite would still block it even after allowing.
            const config = loadConfig(ctx.cwd);
            const { projectPath, globalPath } = getConfigPaths(ctx.cwd);
            if (matchesPattern(blockedPath, config.filesystem?.denyWrite ?? [])) {
              ctx.ui.notify(
                `⚠️ "${blockedPath}" was added to allowWrite, but it is also in denyWrite and will remain blocked.\n` +
                  `Check denyWrite in:\n  ${projectPath}\n  ${globalPath}`,
                "warning",
              );
              return result;
            }

            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: `\n--- Write access granted for "${blockedPath}", retrying ---\n`,
                },
              ],
              details: {},
            });
            return runBash();
          }
        }
      }

      return result;
    },
  });

  // ── user_bash — network pre-check ──────────────────────────────────────────

  pi.on("user_bash", async (event, ctx) => {
    if (!sandboxEnabled || !sandboxInitialized) return;

    const domains = extractDomainsFromCommand(event.command);
    const effectiveDomains = getEffectiveAllowedDomains(ctx.cwd);

    for (const domain of domains) {
      if (!domainIsAllowed(domain, effectiveDomains)) {
        const choice = await promptDomainBlock(ctx, domain);
        if (choice === "abort") {
          return {
            result: {
              output: `Blocked: "${domain}" is not in allowedDomains. Use /sandbox to review your config.`,
              exitCode: 1,
              cancelled: false,
              truncated: false,
            },
          };
        }
        await applyDomainChoice(choice, domain, ctx.cwd);
      }
    }

    return { operations: createSandboxedBashOps(userShellPath, localCwd) };
  });

  // ── tool_call — network pre-check for bash, path policy for read/write/edit/grep/find/ls

  pi.on("tool_call", async (event, ctx) => {
    if (!sandboxEnabled) return;

    const config = loadConfig(ctx.cwd);
    if (!config.enabled) return;

    const { projectPath, globalPath } = getConfigPaths(ctx.cwd);

    // Network pre-check for bash tool calls.
    if (sandboxInitialized && isToolCallEventType("bash", event)) {
      const domains = extractDomainsFromCommand(event.input.command);
      const effectiveDomains = getEffectiveAllowedDomains(ctx.cwd);
      for (const domain of domains) {
        if (!domainIsAllowed(domain, effectiveDomains)) {
          const choice = await promptDomainBlock(ctx, domain);
          if (choice === "abort") {
            return {
              block: true,
              reason: `Network access to "${domain}" is blocked (not in allowedDomains).`,
            };
          }
          await applyDomainChoice(choice, domain, ctx.cwd);
        }
      }
    }

    // Path policy: read/grep/find/ls tools (all read-only filesystem operations).
    //   - If the path is already in effectiveAllowRead, allow silently.
    //   - Otherwise fall back to effectiveAllowWrite (write implies read).
    //     This is important because normalizeAllowRead may have pruned ancestor
    //     paths (e.g. "~/.local") from allowRead to avoid bwrap mount-ordering
    //     conflicts when the cwd is a descendant (e.g. "~/.local/share/chezmoi").
    //   - If neither allowRead nor allowWrite covers the path, prompt.
    //   - Granting (session or permanent) adds to allowRead, which overrides denyRead.
    //   - denyRead is never a hard-block on its own — it just sets the default
    //     denied state that the prompt can override.
    if (
      isToolCallEventType("read", event) ||
      isToolCallEventType("grep", event) ||
      isToolCallEventType("find", event) ||
      isToolCallEventType("ls", event)
    ) {
      const path = canonicalizePath(event.input.path ?? event.input.dir ?? event.input.pattern ?? "");
      if (!path) return; // no path to check
      const effectiveAllowRead = getEffectiveAllowRead(ctx.cwd);
      const effectiveAllowWrite = getEffectiveAllowWrite(ctx.cwd);

      // Check allowRead first, then fall back to allowWrite (write implies read).
      // normalizeAllowRead may have pruned ancestor read paths that conflict
      // with bwrap mount ordering — allowWrite fills the gap since those paths
      // are already writable (and therefore readable) via the child write mount.
      if (!matchesPattern(path, effectiveAllowRead) && !matchesPattern(path, effectiveAllowWrite)) {
        const choice = await promptReadBlock(ctx, path);
        if (choice === "abort") {
          return {
            block: true,
            reason: `Sandbox: read access denied for "${path}"`,
          };
        }
        await applyReadChoice(choice, path, ctx.cwd);
        // Allowed — fall through, tool runs.
        return;
      }
    }

    // Path policy: write/edit — prompt for allowWrite, hard-block for denyWrite.
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path = canonicalizePath((event.input as { path: string }).path);
      const allowWrite = getEffectiveAllowWrite(ctx.cwd);
      const denyWrite = config.filesystem?.denyWrite ?? [];

      // denyWrite takes precedence and is never prompted.
      if (matchesPattern(path, denyWrite)) {
        return {
          block: true,
          reason:
            `Sandbox: write access denied for "${path}" (in denyWrite). ` +
            `To change this, edit denyWrite in:\n  ${projectPath}\n  ${globalPath}`,
        };
      }

      if (shouldPromptForWrite(path, allowWrite, matchesPattern)) {
        const choice = await promptWriteBlock(ctx, path);
        if (choice === "abort") {
          return {
            block: true,
            reason: `Sandbox: write access denied for "${path}" (not in allowWrite)`,
          };
        }
        await applyWriteChoice(choice, path, ctx.cwd);
        // Allowed — fall through, tool runs.
        return;
      }
    }
  });

  // ── session_start ───────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const noSandbox = pi.getFlag("no-sandbox") as boolean;

    if (noSandbox) {
      sandboxEnabled = false;
      updateStatus(ctx);
      ctx.ui.notify("Sandbox disabled via --no-sandbox", "warning");
      return;
    }

    const config = loadConfig(ctx.cwd);

    if (!config.enabled) {
      sandboxEnabled = false;
      updateStatus(ctx);
      ctx.ui.notify("Sandbox disabled via config", "info");
      return;
    }

    const platform = process.platform;
    if (platform !== "darwin" && platform !== "linux") {
      sandboxEnabled = false;
      updateStatus(ctx);
      ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
      return;
    }

    try {
      const configExt = config as unknown as {
        ignoreViolations?: Record<string, string[]>;
        enableWeakerNestedSandbox?: boolean;
        allowBrowserProcess?: boolean;
      };

      await SandboxManager.initialize(
        {
          network: config.network,
          filesystem: config.filesystem,
          ignoreViolations: configExt.ignoreViolations,
          enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox,
          allowBrowserProcess: configExt.allowBrowserProcess,
          enableWeakerNetworkIsolation: true,
        },
        createNetworkAskCallback(config.network?.allowedDomains ?? []),
      );

      // Make Node's built-in fetch() honour HTTP_PROXY / HTTPS_PROXY in this
      // process and any child processes that inherit the environment.
      // NODE_USE_ENV_PROXY avoids NODE_OPTIONS allowlisting issues on older Node
      // versions while still propagating naturally to child `node` processes.
      // fetch() supports this on Node 22.21.0+ and 24.0.0+.
      const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
      const supportsEnvProxy = (nodeMajor === 22 && nodeMinor >= 21) || nodeMajor >= 24;
      if (supportsEnvProxy) {
        process.env.NODE_USE_ENV_PROXY ??= "1";
      }

      sandboxEnabled = true;
      sandboxInitialized = true;
      updateStatus(ctx);

      warnIfAllDomainsAllowed(ctx, config);
    } catch (err) {
      sandboxEnabled = false;
      updateStatus(ctx);
      ctx.ui.notify(
        `Sandbox initialization failed: ${err instanceof Error ? err.message : err}`,
        "error",
      );
    }
  });

  // ── session_shutdown ────────────────────────────────────────────────────────

  pi.on("session_shutdown", async () => {
    if (sandboxInitialized) {
      try {
        await SandboxManager.reset();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ── /sandbox command — on/off/status ────────────────────────────────────────

  pi.registerCommand("sandbox", {
    description: "Manage sandbox extension (on/off/status)",
    handler: async (args, ctx) => {
      const sub = args?.toLowerCase() ?? "status";

      if (sub === "on" || sub === "enable") {
        if (sandboxEnabled) {
          ctx.ui.notify("Sandbox is already enabled", "info");
          return;
        }

        const config = loadConfig(ctx.cwd);
        const platform = process.platform;
        if (platform !== "darwin" && platform !== "linux") {
          ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
          return;
        }

        try {
          const configExt = config as unknown as {
            ignoreViolations?: Record<string, string[]>;
            enableWeakerNestedSandbox?: boolean;
            allowBrowserProcess?: boolean;
          };

          await SandboxManager.initialize(
            {
              network: config.network,
              filesystem: config.filesystem,
              ignoreViolations: configExt.ignoreViolations,
              enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox,
              allowBrowserProcess: configExt.allowBrowserProcess,
              enableWeakerNetworkIsolation: true,
            },
            createNetworkAskCallback(config.network?.allowedDomains ?? []),
          );

          sandboxEnabled = true;
          sandboxInitialized = true;
          updateStatus(ctx);

          warnIfAllDomainsAllowed(ctx, config);
          ctx.ui.notify("Sandbox enabled", "success");
        } catch (err) {
          ctx.ui.notify(
            `Sandbox initialization failed: ${err instanceof Error ? err.message : err}`,
            "error",
          );
        }
        return;
      }

      if (sub === "off" || sub === "disable") {
        if (!sandboxEnabled) {
          ctx.ui.notify("Sandbox is already disabled", "info");
          return;
        }

        if (sandboxInitialized) {
          try {
            await SandboxManager.reset();
          } catch {
            // Ignore cleanup errors
          }
        }

        sandboxEnabled = false;
        sandboxInitialized = false;
        updateStatus(ctx);
        ctx.ui.notify("Sandbox disabled", "info");
        return;
      }

      // status (default)
      if (!sandboxEnabled) {
        ctx.ui.notify("Sandbox is disabled", "info");
        return;
      }

      const config = loadConfig(ctx.cwd);
      const { globalPath, projectPath } = getConfigPaths(ctx.cwd);

      const lines = [
        "Sandbox Configuration",
        `  Project config: ${projectPath}`,
        `  Global config:  ${globalPath}`,
        "",
        "Network (bash + !cmd):",
        `  Allowed domains: ${config.network?.allowedDomains?.join(", ") || "(none)"}`,
        ...(allowsAllDomains(config.network?.allowedDomains)
          ? ['  ⚠️ "*" allows all domains and disables per-domain prompts.']
          : []),
        `  Denied domains:  ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
        ...(sessionAllowedDomains.length > 0
          ? [`  Session allowed: ${sessionAllowedDomains.join(", ")}`]
          : []),
        "",
        "Filesystem (bash + read/write/edit/grep/find/ls tools):",
        `  Deny Read:   ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
        `  Allow Read:  ${config.filesystem?.allowRead?.join(", ") || "(none)"}`,
        `  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(none)"}`,
        `  Deny Write:  ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
        ...(sessionAllowedReadPaths.length > 0
          ? [`  Session read:  ${sessionAllowedReadPaths.join(", ")}`]
          : []),
        ...(sessionAllowedWritePaths.length > 0
          ? [`  Session write: ${sessionAllowedWritePaths.join(", ")}`]
          : []),
        "",
        "Note: ALL reads are prompted unless the path is already in allowRead.",
        "Note: denyRead is not a hard-block — granting a prompt adds to allowRead, overriding denyRead.",
        "Note: denyWrite takes PRECEDENCE over allowWrite and is never prompted.",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
