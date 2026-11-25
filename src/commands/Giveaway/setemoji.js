const { ApplicationCommandOptionType } = require("discord.js");
const Guild = require("../../models/Guild");

module.exports = {
  name: "setemoji",
  description: "Set giveaway button emoji",
  permission: "ManageGuild",
  options: [
    {
      name: "emoji",
      description: "Giveaway button emoji",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  run: async ({ context }) => {
    const emoji = await Guild.resolveEmoji(context.options.getString("emoji", true), context.guild, context.channel);
    if (!emoji) {
      return context.createMessage({
        content: "Choose a Unicode emoji (e.g., 🎉) or a custom emoji the bot can use.",
      });
    }

    await Guild.updateSettings(context.guildId, { giveawayEmoji: emoji });
    return context.createMessage({ content: `Giveaway button emoji updated to **${emoji}**.` });
  },
};
