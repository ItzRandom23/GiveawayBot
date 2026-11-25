module.exports = {
  name: "ping",
  description: "check if bot is online",
  /**
   * @param {{ client: import("../../structures/Client"), context: import("discord.js").ChatInputCommandInteraction | import("discord.js").Message }}
   */
  run: async ({ client, context }) => {
    return await context.createMessage({
      content: "<:yay:1310201036732104746> Pong!",
    });
  },
};
