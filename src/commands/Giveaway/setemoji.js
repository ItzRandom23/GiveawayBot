const { ApplicationCommandOptionType } = require("discord.js");
const data = require("../../models/Guild");

module.exports = {
  name: "setemoji",
  description: "Set giveaway button emoji",
  permission: "ManageGuild",
  options: [
    {
      name: "emoji",
      description: "Set giveaway button emoji",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  run: async ({ client, context }) => {
    const emojiOption = context.options.getString("emoji");

    const emojiRegex = /^<a?:\w+:\d+>$/;

    if (!emojiOption.match(emojiRegex) && emojiOption.length > 2) {
      return context.createMessage({
        content: "❌ Please provide a valid emoji (e.g., 🎉 or :trophy:).",
        flags: 64,
      });
    }

    await data.updateOne(
      { id: context.guildId },
      { $set: { giveawayEmoji: emojiOption } },
      { upsert: true }
    );
    return context.createMessage({
      content: `<:yay:1310201036732104746> Giveaway button emoji has been updated to **${emojiOption}**.`,
    });
  },
};
