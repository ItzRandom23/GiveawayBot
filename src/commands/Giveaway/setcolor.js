const { ApplicationCommandOptionType } = require("discord.js");
const Guild = require("../../models/Guild");

module.exports = {
  name: "setcolor",
  description: "Set giveaway embed color (hex code)",
  permission: "ManageGuild",
  options: [
    {
      name: "hex",
      description: "Hex code of the color",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  run: async ({ context }) => {
    const color = Guild.normalizeColor(context.options.getString("hex", true));
    if (!color) {
      return context.createMessage({ content: "Enter a hex color code (e.g., #FF5733)." });
    }

    await Guild.updateSettings(context.guildId, { embedColor: color });
    return context.createMessage({ content: `Giveaway embed color updated to **${color}**.` });
  },
};
