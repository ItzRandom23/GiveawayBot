const settings = require("../../settings");

function loadConfig() {
  const trimString = (value) => typeof value === "string" ? value.trim() : "";
  const token = (trimString(process.env.DISCORD_TOKEN) || trimString(settings.TOKEN))
    .replace(/^Bot\s+/i, "");
  const mongoUri = trimString(process.env.MONGODB_URI) || trimString(settings.MongoDB);
  const owners = process.env.DISCORD_OWNER_IDS?.split(",") ?? [settings.dev].flat();

  if (!token || !mongoUri) return null;

  return {
    token,
    mongoUri,
    owners: owners.map(trimString).filter((id) => /^\d{17,20}$/.test(id)),
  };
}

function logError(operation, error) {
  // Request and connection errors can carry credentials or user input.
  const type = error?.constructor?.name ?? "Error";
  const code = error?.code;
  const safeCode = typeof code === "number" || (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,60}$/.test(code));
  console.error(operation + " failed (" + type + (safeCode ? ", " + code : "") + ").");
}

module.exports = { loadConfig, logError };
