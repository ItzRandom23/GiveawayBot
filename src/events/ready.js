const { setTimeout: delay } = require("node:timers/promises");
const { ApplicationCommandType, InteractionContextType, Routes } = require("discord.js");
const { logError } = require("../structures/config");

module.exports = async (client, { signal, retryDelayMs = 1_000 } = {}) => {
  if (client.cluster.id !== 0) return;

  const body = client.commands
    .filter(({ category }) => category !== "Owner")
    .map(({ name, description, options }) => ({
      name,
      description,
      options,
      type: ApplicationCommandType.ChatInput,
      contexts: [InteractionContextType.Guild],
    }));

  const route = Routes.applicationCommands(client.user.id);
  while (!signal?.aborted) {
    try {
      const deadline = AbortSignal.timeout(20_000);
      await client.rest.put(route, { body, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
      return;
    } catch (error) {
      if (signal?.aborted) return;
      logError("Slash command registration", error);
    }

    try {
      await delay(retryDelayMs, undefined, { signal });
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    }
    retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
  }
};
