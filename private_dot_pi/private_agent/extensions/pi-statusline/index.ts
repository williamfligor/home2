/**
 * pi-statusline — a powerline-inspired custom footer for pi.
 *
 * Replaces the built-in footer with a segmented powerline-style bar.
 *
 * Left side:  model  ▐  git-branch  ▐  context%
 * Right side: ↑toks ↓toks  ▌  $cost  ▌  ext-statuses
 *
 * Design principles:
 *   • Uses only ctx.ui.setFooter() — does NOT touch the editor (pi-vim safe).
 *   • All colours come from the active pi theme.
 *   • Segments separated by ▐/▌ in the preceding segment's colour for a
 *     powerline transition effect (no nerd-font dependency).
 *   • Toggle with /statusline.
 *   • No code copied from pi-powerline-footer (independent implementation).
 */

import type { ExtensionAPI, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/* ── thinking level display ────────────────────────────────── */

/** Human-readable label + theme colour for each thinking tier. */
const THINKING_LABELS: Record<string, { label: string; color: Parameters<Theme["fg"]>[0] }> = {
  minimal: { label: "think:min", color: "thinkingMinimal" },
  low:     { label: "think:low", color: "thinkingLow" },
  medium:  { label: "think:med", color: "thinkingMedium" },
  high:    { label: "think:high", color: "thinkingHigh" },
  xhigh:   { label: "think:xhigh", color: "thinkingXhigh" },
};

/* ── utilities ────────────────────────────────────────────── */

function fmtTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Shorten model id for compact display */
function fmtModel(id: string): string {
  const s = id.replace(/^claude-/i, "").replace(/^gemini-/i, "");
  return s.length > 20 ? s.slice(0, 18) + "…" : s;
}

function fmtCost(cost: number): string {
  if (cost <= 0) return "";
  if (cost < 0.001) return "<$0.001";
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/* ── usage aggregator ─────────────────────────────────────── */

interface Usage {
  input: number;
  output: number;
  cost: number;
}

function aggregateUsage(ctx: { sessionManager: { getBranch(): unknown[] } }): Usage {
  let input = 0;
  let output = 0;
  let cost = 0;

  for (const entry of ctx.sessionManager.getBranch()) {
    const e = entry as { type?: string; message?: { role?: string; usage?: { input?: number; output?: number; cost?: { total?: number } } } };
    if (e.type === "message" && e.message?.role === "assistant") {
      input += e.message.usage?.input ?? 0;
      output += e.message.usage?.output ?? 0;
      cost += e.message.usage?.cost?.total ?? 0;
    }
  }

  return { input, output, cost };
}

/* ── footer component factory ─────────────────────────────── */

/** The subset of ExtensionContext we actually consume. */
interface FooterContext {
  readonly hasUI: boolean;
  readonly ui: {
    readonly theme: Theme;
    setFooter(
      factory:
        | ((
            tui: TUI,
            theme: Theme,
            footerData: ReadonlyFooterDataProvider,
          ) => { render(width: number): string[]; invalidate(): void; dispose?(): void })
        | undefined,
    ): void;
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
  readonly sessionManager: { getBranch(): unknown[] };
  readonly model?: { id: string; name?: string; reasoning?: boolean; contextWindow?: number };
  getContextUsage?(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  /** Current thinking level (tracked via thinking_level_select events). */
  thinkingLevel: string;
}

function createStatuslineFooter(
  ctx: FooterContext,
): (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
  render(width: number): string[];
  invalidate(): void;
  dispose?(): void;
} {
  return (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose: unsub,
      invalidate() { /* no-op */ },

      render(width: number): string[] {
        const line = buildStatusline(theme, ctx as BuildCtx, footerData, width);
        return [line];
      },
    };
  };
}

/* ── statusline layout engine ─────────────────────────────── */

/**
 * Each segment has a label (the text shown) and a thematic colour.
 * The colour is used for both the text and the separator that follows.
 */
interface BuildCtx {
  sessionManager: { getBranch(): unknown[] };
  model?: { id: string; name?: string; reasoning?: boolean; contextWindow?: number };
  getContextUsage?(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  /** Current thinking level (empty string / "off" means hidden). */
  thinkingLevel: string;
}

function buildStatusline(
  theme: Theme,
  ctx: BuildCtx,
  footerData: ReadonlyFooterDataProvider,
  width: number,
): string {
  /* ── gather data ─────────────────────────────────────── */

  const modelName = ctx.model ? fmtModel(ctx.model.id) : "no-model";
  const branch = footerData.getGitBranch();
  const usage = aggregateUsage(ctx as any);
  const ctxUsage = ctx.getContextUsage?.() ?? null;
  const contextPct = ctxUsage?.percent != null ? ctxUsage.percent : null;
  const thinking = ctx.thinkingLevel;

  /* ── build left segments ──────────────────────────────── */

  interface Label {
    text: string;
    /** ThemeColor literal used for text and following separator. */
    color: Parameters<Theme["fg"]>[0];
  }

  const left: Label[] = [{ text: modelName, color: "accent" }];

  // Thinking level (only when model supports reasoning and level is not "off")
  if (ctx.model?.reasoning && thinking && thinking !== "off") {
    const info = THINKING_LABELS[thinking];
    if (info) {
      left.push({ text: info.label, color: info.color });
    }
  }

  if (branch) {
    left.push({ text: branch, color: "success" });
  }

  if (contextPct != null) {
    const pct = Math.round(contextPct);
    const text = `${pct}%`;
    const color: Parameters<Theme["fg"]>[0] =
      pct >= 90 ? "error" : pct >= 70 ? "warning" : "muted";
    left.push({ text, color });
  }

  /* ── build right segments ─────────────────────────────── */

  const right: Label[] = [];

  if (usage.input > 0 || usage.output > 0) {
    right.push({
      text: `↑${fmtTokens(usage.input)} ↓${fmtTokens(usage.output)}`,
      color: "dim",
    });
  }

  if (usage.cost > 0) {
    right.push({ text: fmtCost(usage.cost), color: "dim" });
  }

  // Extension statuses (eg from other extensions' ctx.ui.setStatus calls)
  const statuses = footerData.getExtensionStatuses();
  if (statuses.size > 0) {
    const parts: string[] = [];
    for (const val of statuses.values()) {
      if (val) parts.push(val);
    }
    if (parts.length > 0) {
      right.push({ text: parts.join(" "), color: "muted" });
    }
  }

  /* ── render left half ─────────────────────────────────── */

  const renderLeft = (segs: Label[]): string => {
    let out = "";
    for (let i = 0; i < segs.length; i++) {
      const { text, color } = segs[i];
      if (i > 0) {
        // Separator in the PREVIOUS segment's colour → powerline transition
        const prevColor = segs[i - 1].color;
        out += theme.fg(prevColor, "▐");
      }
      out += theme.fg(color, ` ${text} `);
    }
    return out;
  };

  /* ── render right half (reversed) ─────────────────────── */

  const renderRight = (segs: Label[]): string => {
    let out = "";
    for (let i = segs.length - 1; i >= 0; i--) {
      const { text, color } = segs[i];
      if (i < segs.length - 1) {
        // On the right side the separator points the other way.
        // Use the colour of the segment that is INWARDS (higher index).
        const inwardsColor = segs[i + 1].color;
        out = theme.fg(inwardsColor, "▌") + out;
      }
      out = theme.fg(color, ` ${text} `) + out;
    }
    return out;
  };

  /* ── layout: left + gap + right, then truncate ──────────── */

  const leftStr = renderLeft(left);
  const rightStr = renderRight(right);

  const lw = visibleWidth(leftStr);
  const rw = visibleWidth(rightStr);
  const gap = Math.max(1, width - lw - rw);
  const gapStr = " ".repeat(gap);

  const full = leftStr + gapStr + rightStr;
  return truncateToWidth(full, width);
}

/* ── extension entry point ─────────────────────────────────── */

export default function (pi: ExtensionAPI) {
  let enabled = true; // active by default
  let thinkingLevel = ""; // tracked via thinking_level_select

  /** Merge the current thinking level into ctx for the footer closure. */
  function buildFooterCtx(ctx: any): FooterContext {
    return {
      ...ctx,
      thinkingLevel: thinkingLevel || ((pi.getThinkingLevel?.() as string) ?? ""),
    };
  }

  function attach(ctx: any): void {
    if (!ctx.hasUI) return;
    ctx.ui.setFooter(createStatuslineFooter(buildFooterCtx(ctx)));
  }

  function detach(ctx: any): void {
    if (!ctx.hasUI) return;
    ctx.ui.setFooter(undefined);
  }

  /* Auto-enable on session start */
  pi.on("session_start", (_event, ctx) => {
    thinkingLevel = (pi.getThinkingLevel?.() as string) ?? "";
    if (enabled) attach(ctx);
  });

  /* Keep thinking level in sync — re-attach so the footer picks it up */
  pi.on("thinking_level_select", ({ level }, ctx) => {
    thinkingLevel = level as string;
    if (enabled && ctx.hasUI) {
      detach(ctx);
      attach(ctx);
    }
  });

  /* Re-attach on model change so model id stays fresh */
  pi.on("model_select", (_event, ctx) => {
    if (enabled) {
      detach(ctx);
      attach(ctx);
    }
  });

  /* /statusline toggle command */
  pi.registerCommand("statusline", {
    description: "Toggle pi-statusline powerline-style footer",
    handler: async (_args, ctx) => {
      enabled = !enabled;

      if (enabled) {
        attach(ctx);
        ctx.ui.notify("Statusline enabled", "info");
      } else {
        detach(ctx);
        ctx.ui.notify("Statusline disabled", "info");
      }
    },
  });
}
