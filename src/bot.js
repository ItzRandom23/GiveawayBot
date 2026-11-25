const GiveawayBot = require("./structures/Client");
const { loadConfig, logError } = require("./structures/config");

async function start() {
  const config = loadConfig();
  if (!config) throw new Error("Missing bot configuration");
  const client = new GiveawayBot(config);
  process.once("disconnect", () => {
    client.destroy()
      .catch((error) => logError("Worker shutdown", error))
      .finally(() => process.exit());
  });

  try {
    await client.build();
  } catch (error) {
    await client.destroy().catch((failure) => logError("Startup cleanup", failure));
    throw error;
  }
}

start().catch((error) => {
  logError("Worker startup", error);
  process.exit(1);
});
