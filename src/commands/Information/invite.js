const { OAuth2Scopes, PermissionFlagsBits } = require("discord.js");

module.exports = {
  name: "invite",
  description: "add the bot to your own server",

  run: async ({ client, context }) => {
    const url = client.generateInvite({
      scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
    return await context.createMessage({
      content: `[Add GiveawayBot to your server](<${url}>)`,
    });
  },
};
