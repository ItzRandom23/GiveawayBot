const Guild = require("../../models/Guild");

module.exports = {
  name: "settings",
  description: "Show the giveaway settings",
  permission: "ManageGuild",

  run: async ({ context }) => {
    const { embedColor, giveawayEmoji } = await Guild.getSettings(context.guildId, context.guild, context.channel);
    return context.createMessage({
      content: `**Giveaway settings**\nColor: ${embedColor}\nEmoji: ${giveawayEmoji}`,
    });
  },
};
