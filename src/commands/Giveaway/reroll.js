const { ApplicationCommandOptionType } = require("discord.js");
const { runGiveawayOperation } = require("../../structures/GiveawayLifecycle");
const { LIMITS } = require("../../structures/Util");

module.exports = {
  name: "reroll",
  description: "Draws new winners for an ended giveaway",
  permission: "ManageGuild",
  options: [
    {
      name: "giveaway_id",
      description: "The message ID of the giveaway to reroll",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "count",
      description: "Number of new winners to draw",
      type: ApplicationCommandOptionType.Integer,
      min_value: 1,
      max_value: LIMITS.maxWinners,
    },
  ],

  run: async (args) => {
    const count = args.context.options.getInteger("count");
    if (count !== null && (!Number.isSafeInteger(count) || count < 1 || count > LIMITS.maxWinners)) {
      return args.context.createMessage({ content: `Choose 1 to ${LIMITS.maxWinners} new winners.` });
    }
    return runGiveawayOperation(args, "reroll", count ?? undefined);
  },
};
