const { EmbedBuilder ,ApplicationCommandOptionType } = require("discord.js");
const gwdata = require("../../models/GiveawayData"); 

module.exports = {
  name: "delete",
  description: "Ends an active giveaway",
  permission: "ManageGuild",
  options: [
    {
      name: "giveaway_id",
      description: "The message ID of the giveaway to end",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  run: async ({ client, context }) => {
    const giveawayId = context.options.getString("giveaway_id");
   
    const GiveawayData = await gwdata.findOne({ messageId: giveawayId , isActive: true});
    if(!GiveawayData) {
        return context.createMessage({
            content: `💥 I could not find any giveaway!`,
            flags: 64,
          });
    }
   await GiveawayData.deleteOne({ messageId: giveawayId });

   
    const channel = client.channels.cache.get(GiveawayData.channelId);
    if (channel) {
      try {
        const giveawayMessage = await channel.messages.fetch(giveawayId);
        if (giveawayMessage) await giveawayMessage.delete();
      } catch (err) {
        console.error(`Failed to delete giveaway message: ${err.message}`);
      }
    }
    return context.createMessage({
      content: `The giveaway for **${GiveawayData.prize}** has ended. Winners have been announced in <#${GiveawayData.channelId}>.`,
      flags: 64,
    });
  },
};
