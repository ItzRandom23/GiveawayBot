const { ApplicationCommandOptionType } = require("discord.js");
const data = require("../../models/Guild");

module.exports = {
  name: "setcolor",
  description: "set giveaway embed color (hex code)",
  permission: "ManageGuild",
  options: [
    {
      name: "hex",
      description: "hex code of the color",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  run: async ({ client, context }) => {
    const colorOption = context.options.getString("hex");

    if (colorOption) {
      const colorRegex = /^#([0-9A-Fa-f]{3}){1,2}$/;

      if (!colorRegex.test(colorOption)) {
        return context.createMessage({
          content: "💥 Please provide a valid hex color code (e.g., #FF5733).",
          flags: 64,
        });
      }

      await data.updateOne(
        { id: context.guildId },
        { $set: { embedColor: colorOption } },
        { upsert: true }
      );
      return context.createMessage({
        content: `<:yay:1310201036732104746> Giveaway embed color has been updated to **${colorOption}**.`,
      });
    }
  },
};
