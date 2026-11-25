const { ApplicationCommandOptionType } = require("discord.js");
const { runGiveawayOperation } = require("../../structures/GiveawayLifecycle");

module.exports = {
  name: "delete",
  description: "Deletes an active giveaway without drawing winners",
  permission: "ManageGuild",
  options: [
    {
      name: "giveaway_id",
      description: "The message ID of the giveaway to delete",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  run: (args) => runGiveawayOperation(args, "delete"),
};
