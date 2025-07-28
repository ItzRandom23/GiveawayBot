const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  time,
} = require("discord.js");
const data = require("../../models/Guild");
const GiveawayData = require("../../models/GiveawayData");

module.exports = {
  name: "create",
  description: "Starts a giveaway (interactive)",
  permission: "ManageGuild",

  run: async ({ client, context, guildData }) => {
    const modal = new ModalBuilder()
      .setCustomId(`giveawayModal-${context.user.id}`)
      .setTitle("Create a Giveaway");

    const durationInput = new TextInputBuilder()
      .setCustomId("duration")
      .setLabel("Duration")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Enter duration (e.g., 1h, 30m, 2d)")
      .setRequired(true);

    const winnersInput = new TextInputBuilder()
      .setCustomId("winnerno")
      .setLabel("Number of Winners")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Enter number of winners (e.g., 1, 2, 3)")
      .setRequired(true);

    const prizeInput = new TextInputBuilder()
      .setCustomId("prize")
      .setLabel("Prize")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Enter the prize (e.g., Gift Card, Role, etc.)")
      .setRequired(true);

    const descriptionInput = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Provide additional details about the giveaway")
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(winnersInput),
      new ActionRowBuilder().addComponents(prizeInput),
      new ActionRowBuilder().addComponents(descriptionInput)
    );

    await context.showModal(modal);

    const filter = (i) =>
      i.customId === `giveawayModal-${context.user.id}` &&
      i.user.id === context.user.id;

    try {
      const modalInteraction = await context.awaitModalSubmit({
        filter,
        time: 300_000
      });
      

      const duration = modalInteraction.fields.getTextInputValue("duration");
      const winnersCount =
        modalInteraction.fields.getTextInputValue("winnerno");
      const prize = modalInteraction.fields.getTextInputValue("prize");
      const description =
        modalInteraction.fields.getTextInputValue("description");

      const durationMs = await client.util.parseDuration(duration);

      if (!durationMs) {
        return modalInteraction.reply({
          content:
            "Invalid duration format! Use formats like `1h`, `30m`, `2d`.",
          flags: 64,
        });
      }

      const endTime = Date.now() + durationMs * 1000;

      const embed = new EmbedBuilder()
      .setColor(guildData.embedColor)
        .setTitle(`**${prize}**`)
        .setDescription(
          `${description}\n\nEnds: <t:${Math.floor(
            endTime / 1000
          )}:R> (<t:${Math.floor(endTime / 1000)}:f>)\nHosted by: <@${
            context.user.id
          }>\nEntries: **0**\nWinners: **${winnersCount}**`
        )
        .setTimestamp();

      const emoji = guildData.giveawayEmoji;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("enterGiveaway")
          .setStyle(ButtonStyle.Primary)
          .setEmoji(emoji)
      );

      const message = await context.channel.send({
        embeds: [embed],
        components: [row],
      });

      const giveaway = new GiveawayData({
        id: context.guild.id,
        channelId: context.channel.id,
        description,
        messageId: message.id,
        prize,
        hostId: context.user.id,
        winnersCount,
        startTime: Date.now(),
        endTime,
        participants: [],
        isActive: true,
        entryCount: 0,
      });

      await giveaway.save();

      await modalInteraction.reply({
        content: `Giveaway successfully created! **ID:** ${message.id}`,
        flags: 64,
      });
    } catch (err) {
      console.error(`Error handling modal submission: ${err}`);
      return context.followUp({
        content: "You did not submit the form in time!",
        flags: 64,
      });
    }
  },
};
