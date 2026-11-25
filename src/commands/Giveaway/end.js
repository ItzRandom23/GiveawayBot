const { ApplicationCommandOptionType } = require("discord.js");
const { runGiveawayOperation } = require("../../structures/GiveawayLifecycle");

module.exports = {
  name: "end",
  description: "Ends an active giveaway and draws winners",
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

  run: (args) => runGiveawayOperation(args, "end"),
};
