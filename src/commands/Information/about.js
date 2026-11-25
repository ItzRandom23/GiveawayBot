const { EmbedBuilder } = require("discord.js");
const GiveawayData = require("../../models/GiveawayData");
module.exports = {
  name: "about",
  description: "show information about the bot",

  run: async ({ client, context, guildData }) => {
    const [clusterCounts, giveawayCount] = await Promise.all([
      client.cluster.broadcastEval((cluster) => cluster.guilds.cache.size, { timeout: 5_000 }).catch(() => null),
      GiveawayData.estimatedDocumentCount(),
    ]);
    const guildCount = clusterCounts?.reduce((total, count) => total + count, 0);

    return await context.createMessage({
      content:
        "<:yay:1310201036732104746> All about **GiveawayBot** <:yay:1310201036732104746>",
      embeds: [
        new EmbedBuilder()
          .setColor(guildData.embedColor)
          .setTitle("Hold giveaways quickly and easily!")
          .setDescription(
            `Hello! I'm **GiveawayBot**, and I'm here to make it as easy as possible to hold giveaways on your Discord server! I was created by [random.js](https://discord.com/users/878975596623986700) (<@878975596623986700>). \nDon't forget to star this project at **https://github.com/ItzRandom23/GiveawayBot/**!`
          )
          .addFields({
            name: "📊 Stats",
            value: `${giveawayCount} giveaways\n${guildCount == null ? "Server count unavailable" : guildCount + " servers"}`,
            inline: true,
          })
          .addFields({
            name: "🌐 Links",
            value: `[Source Code](https://github.com/ItzRandom23/GiveawayBot)\n[Support](https://discord.gg/yfhtR5RJ)`,
            inline: true,
          }),
      ],
    });
  },
};
