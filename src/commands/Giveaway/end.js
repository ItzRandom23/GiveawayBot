const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const gwdata = require("../../models/GiveawayData");

module.exports = {
  name: "end",
  description: "Ends an active giveaway",
  permission: "ManageGuild",
  options: [
    {
      name: "giveaway_id",
      description: "Select the giveaway to end",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true, 
    },
  ],

  run: async ({ client, context }) => {
    const giveawayId = context.options.getString("giveaway_id");

    const GiveawayData = await gwdata.findOne({
      messageId: giveawayId,
      isActive: true,
    });
    if (!GiveawayData) {
      return context.createMessage({
        content: "💥 I could not find any active giveaway with the provided ID!",
        flags: 64,
      });
    }

    await client.util.endGiveawayEmbed(giveawayId, GiveawayData);

    return context.createMessage({
      content: `The giveaway for **${GiveawayData.prize}** has ended. Winners have been announced in <#${GiveawayData.channelId}>.`,
      flags: 64,
    });
  },
};
