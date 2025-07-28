const { ApplicationCommandOptionType } = require("discord.js");
const gwdata = require("../../models/GiveawayData"); 

module.exports = {
  name: "reroll",
  description: "rerolls one new winner from a giveaway",
  permission: "ManageGuild",
  options: [
    {
      name: "giveaway_id",
      description: "ID of the giveaway to reroll",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "count",
      description: "number of new winners to pick",
      type: ApplicationCommandOptionType.Integer,
      required: false,
    },
  ],

  run: async ({ client, context }) => {
    const giveawayId = context.options.getString("giveaway_id");
    const winnerCount = context.options.getInteger("count");

    const GiveawayData = await gwdata.findOne({ messageId: giveawayId , isActive: false});
    if(!GiveawayData) {
        return context.createMessage({
            content: `💥 I could not find any giveaway!`,
            flags: 64,
          });
    }
    if (winnerCount) {
      GiveawayData.winnersCount = winnerCount;
      await GiveawayData.save();
    }

    if (GiveawayData.participants.length < GiveawayData.winnersCount) {
      return context.createMessage({
        content: `Not enough participants to pick ${winnersToPick} winners.`,
        flags: 64,
      });
    }
    await client.util.rerollGiveawayEmbed(giveawayId, GiveawayData);

    return context.createMessage({
      content: `Rerolled.`,
      flags: 64,
    });
  },
};
