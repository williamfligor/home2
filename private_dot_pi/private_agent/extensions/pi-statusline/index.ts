/**
 * pi-statusline — a powerline-inspired footer for pi.
 *
 * Footer:
 *   model  think:med ▐ hostname ▐ ~/cwd ▐ branch    12m34s ▌ 4.2k/200K (2.1%) ▌ $0.042 ▌ ext-statuses
 *
 * Also customises the streaming working indicator (Amp-style pulsing dot).
 *
 * Design principles:
 *   • Uses only setFooter + setWorkingIndicator — does NOT touch the editor
 *     component or its borders (pi-vim safe).
 *   • All colours come from the active pi theme.
 *   • No code copied from pi-powerline-footer (independent implementation).
 *   • Toggle with /statusline.
 */

import { hostname as osHostname } from "node:os";
import { homedir } from "node:os";
import type { ExtensionAPI, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/* ══════════════════════════════════════════════════════════════
   constants
   ══════════════════════════════════════════════════════════════ */

const HOSTNAME = osHostname();
const HOME = homedir().replace(/\/?$/, "");

/** Human-readable label + theme colour for each thinking tier. */
const THINKING_LABELS: Record<string, { label: string; color: Parameters<Theme["fg"]>[0] }> = {
  minimal: { label: "think:min", color: "thinkingMinimal" },
  low:     { label: "think:low", color: "thinkingLow" },
  medium:  { label: "think:med", color: "thinkingMedium" },
  high:    { label: "think:high", color: "thinkingHigh" },
  xhigh:   { label: "think:xhigh", color: "thinkingXhigh" },
};

/* ══════════════════════════════════════════════════════════════
   utilities
   ══════════════════════════════════════════════════════════════ */

function fmtTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtPath(cwd: string): string {
  let p = cwd;
  if (HOME && p.startsWith(HOME)) p = `~${p.slice(HOME.length)}`;
  const MAX = 40;
  if (p.length > MAX) {
    const parts = p.split("/");
    const tail = parts.slice(-3);
    if (tail.length < parts.length) p = `…/${tail.join("/")}`;
  }
  return p;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1_000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

function fmtCost(cost: number): string {
  if (cost <= 0) return "";
  if (cost < 0.001) return "<$0.001";
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function fmtModelLabel(model: { id: string; name?: string } | undefined): string {
  if (!model) return "no-model";
  if (model.name) return model.name;
  return model.id.replace(/^claude-/i, "").replace(/^gemini-/i, "");
}

/** Format context usage: "4/1.0M (0.0%)" */
function fmtContextUsage(
  tokens: number | null,
  contextWindow: number,
  percent: number | null,
): { main: string; pct: string; pctColor: Parameters<Theme["fg"]>[0] } {
  const used = tokens != null ? fmtTokens(tokens) : "?";
  const win = contextWindow > 0 ? fmtTokens(contextWindow) : "?";
  const main = `${used}/${win}`;
  let pct: string;
  let pctColor: Parameters<Theme["fg"]>[0];
  if (percent != null) {
    pct = `(${percent.toFixed(1)}%)`;
    pctColor = percent >= 90 ? "error" : percent >= 70 ? "warning" : "muted";
  } else {
    pct = "";
    pctColor = "muted";
  }
  return { main, pct, pctColor };
}

/* ══════════════════════════════════════════════════════════════
   usage aggregator
   ══════════════════════════════════════════════════════════════ */

interface Usage { input: number; output: number; cost: number }

function aggregateUsage(ctx: { sessionManager: { getBranch(): unknown[] } }): Usage {
  let input = 0, output = 0, cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    const e = entry as {
      type?: string;
      message?: { role?: string; usage?: { input?: number; output?: number; cost?: { total?: number } } };
    };
    if (e.type === "message" && e.message?.role === "assistant") {
      input += e.message.usage?.input ?? 0;
      output += e.message.usage?.output ?? 0;
      cost += e.message.usage?.cost?.total ?? 0;
    }
  }
  return { input, output, cost };
}

/* ══════════════════════════════════════════════════════════════
   footer component factory
   ══════════════════════════════════════════════════════════════ */

interface FooterContext {
  readonly hasUI: boolean;
  readonly cwd: string;
  readonly ui: {
    readonly theme: Theme;
    setFooter: (f: unknown) => void;
    notify: (m: string, t?: "info" | "warning" | "error") => void;
    setWorkingIndicator: (opts?: { frames?: readonly string[]; intervalMs?: number }) => void;
    setWorkingMessage: (msg?: string) => void;
  };
  readonly sessionManager: { getBranch(): unknown[] };
  readonly model?: { id: string; name?: string; reasoning?: boolean; contextWindow?: number };
  getContextUsage?(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  sessionStart: number;
  thinkingLevel: string;
}

interface Label { text: string; color: Parameters<Theme["fg"]>[0] }

function createStatuslineFooter(ctx: FooterContext) {
  return (
    tui: TUI,
    theme: Theme,
    footerData: ReadonlyFooterDataProvider,
  ): { render(width: number): string[]; invalidate(): void; dispose?(): void } => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose: unsub,
      invalidate() { /* no-op */ },
      render(width: number): string[] {
        const line = buildFooterLine(theme, ctx, footerData, width);
        return [line];
      },
    };
  };
}

/* ══════════════════════════════════════════════════════════════
   footer line layout
   ══════════════════════════════════════════════════════════════ */

function buildFooterLine(
  theme: Theme,
  ctx: FooterContext,
  footerData: ReadonlyFooterDataProvider,
  width: number,
): string {
  /* data ── */
  const modelLabel = fmtModelLabel(ctx.model);
  const modelHasReasoning = ctx.model?.reasoning ?? false;
  const cwd = fmtPath(ctx.cwd);
  const branch = footerData.getGitBranch();
  const usage = aggregateUsage(ctx);
  const ctxUsage = ctx.getContextUsage?.() ?? null;
  const tokens = ctxUsage?.tokens ?? null;
  const contextWindow = ctxUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const percent = ctxUsage?.percent ?? null;
  const ctxFmt = fmtContextUsage(tokens, contextWindow, percent);
  const sessElapsed = ctx.sessionStart > 0 ? Date.now() - ctx.sessionStart : 0;
  const sessStr = sessElapsed > 0 ? fmtDuration(sessElapsed) : "";
  const statusParts: string[] = [];
  for (const val of footerData.getExtensionStatuses().values()) {
    if (val) statusParts.push(val);
  }

  /* left segments ── */

  const left: Label[] = [{ text: modelLabel, color: "accent" }];

  // Thinking level
  const tl = ctx.thinkingLevel;
  if (modelHasReasoning && tl && tl !== "off") {
    const info = THINKING_LABELS[tl];
    if (info) left.push({ text: info.label, color: info.color });
  }

  left.push({ text: HOSTNAME, color: "dim" });
  left.push({ text: cwd, color: "muted" });
  if (branch) left.push({ text: branch, color: "success" });

  /* right segments ── */

  const right: Label[] = [];
  if (sessStr) right.push({ text: sessStr, color: "dim" });
  right.push({ text: ctxFmt.main, color: "muted" });
  if (ctxFmt.pct) right.push({ text: ctxFmt.pct, color: ctxFmt.pctColor });
  const costStr = fmtCost(usage.cost);
  if (costStr) right.push({ text: costStr, color: "dim" });
  if (statusParts.length > 0) right.push({ text: statusParts.join(" "), color: "muted" });

  /* render left (→ direction) ── */

  const renderLeft = (segs: Label[]): string => {
    let out = "";
    for (let i = 0; i < segs.length; i++) {
      const { text, color } = segs[i];
      if (i > 0) out += theme.fg(segs[i - 1].color, "▐");
      out += theme.fg(color, ` ${text} `);
    }
    return out;
  };

  /* render right (← direction) ── */

  const renderRight = (segs: Label[]): string => {
    let out = "";
    for (let i = segs.length - 1; i >= 0; i--) {
      const { text, color } = segs[i];
      if (i < segs.length - 1) out = theme.fg(segs[i + 1].color, "▌") + out;
      out = theme.fg(color, ` ${text} `) + out;
    }
    return out;
  };

  /* layout ── */

  const leftStr = renderLeft(left);
  const rightStr = renderRight(right);
  const gap = Math.max(1, width - visibleWidth(leftStr) - visibleWidth(rightStr));
  return truncateToWidth(leftStr + " ".repeat(gap) + rightStr, width);
}

/* ══════════════════════════════════════════════════════════════
   extension entry point
   ══════════════════════════════════════════════════════════════ */

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let sessionStart = 0;
  let thinkingLevel = "";

  /* ── helpers ── */

  function attachFooter(ctx: any): void {
    if (!ctx.hasUI) return;
    const footerCtx: FooterContext = {
      ...ctx,
      sessionStart,
      thinkingLevel: thinkingLevel || ((pi.getThinkingLevel?.() as string) ?? ""),
    };
    ctx.ui.setFooter(createStatuslineFooter(footerCtx));
  }

  function detachFooter(ctx: any): void {
    if (!ctx.hasUI) return;
    ctx.ui.setFooter(undefined);
  }

  function setupWorkingIndicator(ctx: any): void {
    if (!ctx.hasUI) return;
    const modelLabel = fmtModelLabel(ctx.model);
    ctx.ui.setWorkingIndicator({
      frames: ["○", "◔", "●", "◕"],
      intervalMs: 160,
    });
    ctx.ui.setWorkingMessage(modelLabel ? `${modelLabel} working…` : "working…");
  }

  function restoreWorkingIndicator(ctx: any): void {
    if (!ctx.hasUI) return;
    ctx.ui.setWorkingIndicator();
    ctx.ui.setWorkingMessage();
  }

  function attachAll(ctx: any): void {
    attachFooter(ctx);
    setupWorkingIndicator(ctx);
  }

  function detachAll(ctx: any): void {
    detachFooter(ctx);
    restoreWorkingIndicator(ctx);
  }

  /* ── events ── */

  pi.on("session_start", (_event, ctx) => {
    sessionStart = Date.now();
    thinkingLevel = (pi.getThinkingLevel?.() as string) ?? "";
    if (enabled) attachAll(ctx);
  });

  pi.on("session_shutdown", () => {
    sessionStart = 0;
  });

  pi.on("model_select", (_event, ctx) => {
    if (!enabled || !ctx.hasUI) return;
    detachFooter(ctx);
    attachFooter(ctx);
    ctx.ui.setWorkingMessage(
      `${fmtModelLabel(ctx.model)} working…`,
    );
  });

  pi.on("thinking_level_select", ({ level }, ctx) => {
    thinkingLevel = level as string;
    if (!enabled || !ctx.hasUI) return;
    detachFooter(ctx);
    attachFooter(ctx);
  });

  pi.on("turn_start", (_event, ctx) => {
    // Amp-style: working indicator is already customised via setWorkingIndicator
  });

  pi.on("turn_end", (_event, ctx) => {
    // no-op; the working indicator restores automatically when streaming ends
  });

  /* ── toggle ── */

  pi.registerCommand("statusline", {
    description: "Toggle pi-statusline powerline-style footer",
    handler: async (_args, ctx) => {
      enabled = !enabled;

      if (enabled) {
        attachAll(ctx);
        ctx.ui.notify("Statusline enabled", "info");
      } else {
        detachAll(ctx);
        ctx.ui.notify("Statusline disabled", "info");
      }
    },
  });
}
