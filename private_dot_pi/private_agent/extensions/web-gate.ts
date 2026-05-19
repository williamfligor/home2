import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const gatedTools = ["web_search", "open_url", "web_fetch", "batch_web_fetch"];
  let sessionAllowed = false;
  let allowedUntil = 0; // timestamp, 0 = not active

  function isAllowed(): boolean {
    if (sessionAllowed) return true;
    if (allowedUntil && Date.now() < allowedUntil) return true;
    if (allowedUntil) allowedUntil = 0; // expired, clean up
    return false;
  }

  pi.on("tool_call", async (event, ctx) => {
    if (!gatedTools.includes(event.toolName)) return undefined;

    if (isAllowed()) return undefined;

    if (!ctx.hasUI) {
      return { block: true, reason: "Network tool blocked (no UI for confirmation)" };
    }

    const input = event.toolName === "web_search"
      ? `query: ${(event.input as any).query}`
      : `url: ${(event.input as any).url}`;

    const choice = await ctx.ui.select(
      `🌐 ${event.toolName} requested:\n\n  ${input}\n\nAllow?`,
      ["Yes", "Yes (for 5 minutes)", "Yes (for this session)", "No"],
    );

    if (choice === "Yes (for this session)") {
      sessionAllowed = true;
    } else if (choice === "Yes (for 5 minutes)") {
      allowedUntil = Date.now() + 5 * 60 * 1000;
    } else if (choice === "No") {
      return { block: true, reason: "Blocked by user" };
    }

    return undefined;
  });
}
