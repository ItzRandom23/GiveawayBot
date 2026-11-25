const {
  ActionRowBuilder,
  DiscordjsErrorCodes,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const Guild = require("../../models/Guild");
const {
  getPostingPermissionError,
  hasCommandPermission,
  LIMITS,
  SAFE_MENTIONS,
} = require("../../structures/Util");

const PERMISSION = "ManageGuild";

function buildModal(customId) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("Create a Giveaway");
  const fields = [
    { id: "duration", label: "Duration", placeholder: "Examples: 30m, 1h, 2d", maxLength: 10 },
    { id: "winnerno", label: "Number of Winners", maxLength: String(LIMITS.maxWinners).length },
    { id: "prize", label: "Prize", maxLength: LIMITS.maxPrizeLength },
    { id: "description", label: "Description", maxLength: LIMITS.maxDescriptionLength, optional: true },
  ];
  for (const { id, label, placeholder, maxLength, optional } of fields) {
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setStyle(optional ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setMaxLength(maxLength)
      .setRequired(!optional);
    if (placeholder) input.setPlaceholder(placeholder);
    if (LabelBuilder && typeof modal.addLabelComponents === "function") {
      modal.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
    } else {
      modal.addComponents(new ActionRowBuilder().addComponents(input.setLabel(label)));
    }
  }
  return modal;
}

module.exports = {
  name: "create",
  description: "Starts a giveaway (interactive)",
  permission: PERMISSION,

  async run({ client, context }) {
    const customId = `giveaway-create:${context.id}`;
    await context.showModal(buildModal(customId));

    let submission;
    try {
      submission = await context.awaitModalSubmit({
        filter: (interaction) =>
          interaction.customId === customId &&
          interaction.user.id === context.user.id &&
          interaction.guildId === context.guildId &&
          interaction.channelId === context.channelId,
        time: 5 * 60_000,
      });
    } catch (error) {
      if (error.code === DiscordjsErrorCodes.InteractionCollectorError) return;
      throw error;
    }
    await submission.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (!hasCommandPermission(client, submission, PERMISSION)) {
        return await submission.editReply("You need the Manage Server permission to create a giveaway.");
      }
      const permissionError = getPostingPermissionError(submission);
      if (permissionError) return await submission.editReply(permissionError);

      const seconds = client.util.parseDuration(submission.fields.getTextInputValue("duration"));
      const winnersInput = submission.fields.getTextInputValue("winnerno").trim();
      const winnersCount = Number(winnersInput);
      const prize = submission.fields.getTextInputValue("prize").trim();
      const description = submission.fields.getTextInputValue("description").trim();

      if (seconds === null) {
        return await submission.editReply("Enter a duration from 1 second through 365 days, such as `30m`, `1h`, or `2d`.");
      }
      if (!/^\d+$/.test(winnersInput) || winnersCount < 1 || winnersCount > LIMITS.maxWinners) {
        return await submission.editReply(`Enter a whole number from 1 to ${LIMITS.maxWinners} for the winner count.`);
      }
      if (!prize || prize.length > LIMITS.maxPrizeLength || description.length > LIMITS.maxDescriptionLength) {
        return await submission.editReply(
          `Enter a prize up to ${LIMITS.maxPrizeLength} characters and an optional description up to ${LIMITS.maxDescriptionLength} characters.`
        );
      }

      const guildData = await Guild.getSettings(submission.guildId, submission.guild, submission.channel);
      const message = await client.util.createGiveaway({
        requestId: submission.id,
        channel: submission.channel,
        guildData,
        userId: submission.user.id,
        prize,
        description,
        seconds,
        winnersCount,
      });
      const content = message.pending
        ? `Giveaway creation is queued.${message.id ? ` Message ID: ${message.id}` : ""}`
        : `Giveaway successfully created! **ID:** ${message.id}`;
      return await submission.editReply({
        content,
        allowedMentions: SAFE_MENTIONS,
      });
    } catch (error) {
      console.error("Failed to handle giveaway creation form.", error.code ?? error.name);
      return await submission.editReply("The giveaway request could not be completed.").catch(() => {});
    }
  },
};
