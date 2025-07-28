const {
  ButtonInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  InteractionType,
} = require("discord.js");
const guildSchema = require("../models/Guild");
const GiveawayData = require("../models/GiveawayData");

/**
 * @param {import("../structures/Client")} client
 * @param {import('discord.js').CommandInteraction} interaction
 */

module.exports = async (client, interaction) => {
  if (!client.isReady() || !interaction.guild?.available) return;
  if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
    if (interaction.commandName === "end") {
      try {
        const focusedValue = interaction.options.getFocused();
        const activeGiveaways = await GiveawayData.find({
          id: interaction.guild.id,
          isActive: true,
        });

        const giveaways = Array.isArray(activeGiveaways) ? activeGiveaways : [];

        let choices = [];
        if (giveaways.length > 0) {
          giveaways.forEach((giveaway) => {
            choices.push({
              name: `${giveaway.prize} (${giveaway.messageId})`,
              value: giveaway.messageId,
            });
          });
        } else {
          choices.push({
            name: "No active giveaways found",
            value: "none",
          });
        }

        const filteredChoices = choices.filter((choice) =>
          choice.name.toLowerCase().includes(focusedValue.toLowerCase())
        );

        await interaction.respond(filteredChoices.slice(0, 25));
      } catch (error) {
        console.error("Error in autocomplete handler:", error);
        await interaction.respond([
          {
            name: "Error fetching giveaways",
            value: "error",
          },
        ]);
      }
    }
  }

  if (interaction instanceof ChatInputCommandInteraction) {
    let guildData = async () => {
      if (await guildSchema.findOne({ id: interaction.guildId })) {
        return await guildSchema.findOne({ id: interaction.guildId });
      } else {
        return new guildSchema({ id: interaction.guildId }).save();
      }
    };
    guildData = await guildData();
    const command = client.commands.get(interaction.commandName);

    if (command) {
      if (interaction.commandName === "list") {
        await interaction.deferReply();
      } else if (interaction.commandName !== "create") {
        await interaction.deferReply({ flags: 64 });
      }

      if (
        !interaction.guild.members.me.permissions.has(
          PermissionFlagsBits.SendMessages
        ) ||
        !interaction.channel
          .permissionsFor(client.user.id)
          .has(PermissionFlagsBits.SendMessages)
      ) {
        const user = await interaction.guild?.members.fetch(
          interaction.member.id
        );
        if (!user.dmChannel) await user.createDM();
        return await user.dmChannel
          ?.send({
            embeds: [
              {
                description: ` Give me \`Send_Message\` permission in <#${interaction.channelId}> - **${interaction.guild.name}** first.`,
              },
            ],
          })
          .then(() => interaction.deleteReply());
      }
      if (
        !interaction.channel
          .permissionsFor(client.user.id)
          .has(PermissionFlagsBits.ViewChannel)
      )
        return;
      if (
        !interaction.channel
          .permissionsFor(client.user.id)
          .has(PermissionFlagsBits.ReadMessageHistory)
      )
        return;

      if (
        !interaction.guild.members.me.permissions.has(
          PermissionFlagsBits.EmbedLinks
        ) ||
        !interaction.channel
          .permissionsFor(client.user.id)
          .has(PermissionFlagsBits.EmbedLinks)
      ) {
        return interaction.followUp({
          content: ` Give me \`Embed_Links\` permission in <#${interaction.channelId}> first.`,
        });
      }
      if (
        command.permission &&
        !interaction.member.permissions.has(
          PermissionFlagsBits[command.permission]
        ) &&
        !client.owners.includes(interaction.member.id)
      ) {
        return interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor("Red")
              .setDescription(
                ` You don't have the \`${command.permission}\`  permission to use this command`
              ),
          ],
        });
      }

      interaction.isInteraction = true;
      interaction.createMessage = async (options) =>
        await interaction.followUp(options);

      return command
        .run({ client, context: interaction, guildData })
        .catch(console.log);
    }
  }
  if (interaction instanceof ButtonInteraction) {
    if (interaction.customId === "enterGiveaway") {
      await client.util.handleGiveawayButton(
        interaction,
        interaction.message.id
      );
    }
  }
};
