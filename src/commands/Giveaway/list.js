const { EmbedBuilder } = require("discord.js");
const gwdata = require("../../models/GiveawayData");

module.exports = {
  name: "list",
  description: "Lists active giveaways in the server",
  permission: "ViewChannel",

  run: async ({ client, context, guildData }) => {
    const activeGiveaways = await gwdata.find({
      isActive: true,
      id: context.guild.id,
    });

    if (!activeGiveaways.length) {
      return await context.createMessage({
        embeds: [
          new EmbedBuilder()
            .setColor("Red")
            .setDescription(`❌ There are no active giveaways in this server.`),
        ],
        flags: 64,
      });
    }
    let pagesNum = Math.ceil(activeGiveaways.length / 10);
    if (pagesNum === 0) pagesNum = 1;

    if (activeGiveaways.length <= 10) {
      let i = 0;
      const list = activeGiveaways
        .map((giveaway, index) => {
          const endsIn = `<t:${Math.floor(
            new Date(giveaway.endTime).getTime() / 1000
          )}:R>`;
          return `\`${index + 1}.\` [**${
            giveaway.prize
          }**](https://discord.com/channels/${context.guild.id}/${
            giveaway.channelId
          }/${giveaway.messageId}) (Active) • Ends: ${endsIn}`;
        })
        .join("\n");
      return await context.createMessage({
        embeds: [
          new EmbedBuilder()
          .setColor(guildData.embedColor)
            .setAuthor({
              name: `${context.guild.name}'s Active Giveaways`,
            })
            .setDescription(list),
        ],
      });
    }

    const list = [];
    for (let i = 0; i < activeGiveaways.length; i += 10) {
      const pageGiveaways = activeGiveaways.slice(i, i + 10);
      list.push(
        pageGiveaways
          .map((giveaway, index) => {
            const endsIn = `<t:${Math.floor(
              new Date(giveaway.endTime).getTime() / 1000
            )}:R>`;
            return `\`${i + index + 1}.\` [**${
              giveaway.prize
            }**](https://discord.com/channels/${context.guild.id}/${
              giveaway.channelId
            }/${giveaway.messageId}) (Active) • Ends: ${endsIn}`;
          })
          .join("\n")
      );
    }

    const embeds = [];
    for (let i = 0; i < list.length; i++) {
      embeds.push(
        new EmbedBuilder()
        .setColor(guildData.embedColor)
          .setAuthor({
            name: `${context.guild.name}'s Active Giveaways`,
          })
          .setDescription(list[i])
          .setFooter({ text: `Page ${i + 1} of ${list.length}` })
      );
    }

    return client.util.paginate(context, embeds);
  },
};
