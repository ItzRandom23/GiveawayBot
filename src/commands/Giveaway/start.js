const { ApplicationCommandOptionType } = require("discord.js");
const { LIMITS } = require("../../structures/Util");

module.exports = {
  name: "start",
  description: "Starts a giveaway",
  permission: "ManageGuild",
  options: [
    {
      name: "duration",
      description: "Duration, such as 30s, 5m, 1h, or 2d",
      type: ApplicationCommandOptionType.String,
      required: true,
      max_length: 16,
    },
    {
      name: "winners",
      description: "Number of winners",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      min_value: 1,
      max_value: LIMITS.maxWinners,
    },
    {
      name: "prize",
      description: "The prize being given away",
      type: ApplicationCommandOptionType.String,
      required: true,
      max_length: LIMITS.maxPrizeLength,
    },
  ],

  run: async ({ client, context, guildData }) => {
    const prize = context.options.getString("prize", true).trim();
    const winnersCount = context.options.getInteger("winners", true);
    const seconds = client.util.parseDuration(context.options.getString("duration", true));

    if (seconds === null) {
      return context.createMessage({
        content: "Use a duration from 1 second to 365 days, such as `30s`, `5m`, `1h`, or `2d`.",
      });
    }
    if (!Number.isSafeInteger(winnersCount) || winnersCount < 1 || winnersCount > LIMITS.maxWinners) {
      return context.createMessage({ content: `Choose 1 to ${LIMITS.maxWinners} winners.` });
    }
    if (!prize || prize.length > LIMITS.maxPrizeLength) {
      return context.createMessage({ content: `Enter a prize of 1 to ${LIMITS.maxPrizeLength} characters.` });
    }

    const message = await client.util.createGiveaway({
      requestId: context.id,
      channel: context.channel,
      guildData,
      userId: context.user.id,
      prize,
      seconds,
      winnersCount,
    });
    if (message.pending) {
      return context.createMessage({
        content: message.id ? `Giveaway creation is queued. Message ID: ${message.id}` : "Giveaway creation is queued.",
      });
    }
    return context.createMessage({ content: `Giveaway created. Message ID: ${message.id}` });
  },
};
