import { collectBundledPluginBuildEntries } from "./lib/bundled-plugin-build-entries.mjs";

// The desk uses Telegram and an externally managed Weixin plugin.
const unusedChannels = new Set([
  "discord",
  "googlechat",
  "imessage",
  "matrix",
  "mattermost",
  "msteams",
  "signal",
  "slack",
  "zalo",
]);
const entries = collectBundledPluginBuildEntries({ env: {} });
console.log(entries.map(({ id }) => id).filter((id) => !unusedChannels.has(id)).join(","));
