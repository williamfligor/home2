import { SettingsManager } from "@earendil-works/pi-coding-agent";

const proto = SettingsManager.prototype as Record<string, unknown>;

const noop = () => {};

// Prevent pi from auto-updating these settings fields in settings.json
proto.setDefaultModelAndProvider = noop;
proto.setDefaultModel = noop;
proto.setDefaultProvider = noop;
proto.setDefaultThinkingLevel = noop;
proto.setLastChangelogVersion = noop;

export default noop;
