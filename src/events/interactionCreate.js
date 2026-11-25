const { setTimeout: wait } = require("node:timers/promises");
const { MessageFlags } = require("discord.js");
const Guild = require("../models/Guild");
const GiveawayData = require("../models/GiveawayData");
const {
  activeGiveawayFilter,
  canViewGiveaway,
  getAutocompleteChannels,
  getPostingPermissionError,
  hasCommandPermission,
  isSnowflake,
  SAFE_MENTIONS,
  truncate,
} = require("../structures/Util");

const SETTINGS_COMMANDS = new Set(["about", "help", "list", "start"]);
const MAX_CHOICES = 25;
const MAX_PRIVATE_THREAD_CHECKS = 4;

async function collectEndChoices(interaction, choices, signal) {
  const channels = getAutocompleteChannels(interaction);
  if (!channels.size) return;

  const filter = {
    ...activeGiveawayFilter(interaction.guildId),
    channelId: { $in: [...channels.keys()] },
  };
  const search = interaction.options.getFocused().trim().slice(0, 100);
  if (search) {
    const literal = new RegExp(search.replace(/[.*+?^${}$()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ prize: literal }, { messageId: literal }];
  }
  const giveaways = await GiveawayData.find(filter)
    .select("prize messageId channelId")
    .sort({ endTime: 1, messageId: 1 })
    .limit(MAX_CHOICES * 2)
    .maxTimeMS(1500)
    .lean();
  if (signal.aborted) return;

  const pendingChecks = new Map();
  await Promise.all(giveaways.map(async ({ prize, messageId, channelId }, index) => {
    if (!isSnowflake(messageId) || !channels.has(channelId)) return;
    if (channels.get(channelId) !== true) {
      if (!pendingChecks.has(channelId) && pendingChecks.size < MAX_PRIVATE_THREAD_CHECKS) {
        pendingChecks.set(channelId, canViewGiveaway(interaction, channelId, { force: true }));
      }
      if (!await pendingChecks.get(channelId)) return;
    }
    if (signal.aborted) return;
    choices[index] = {
      name: `${truncate(prize || "Giveaway", 97 - messageId.length)} (${messageId})`,
      value: messageId,
    };
  }));
}

async function getEndChoicesWithinDeadline(interaction) {
  const timer = new AbortController();
  const choices = [];
  try {
    await Promise.race([
      collectEndChoices(interaction, choices, timer.signal),
      wait(1800, undefined, { signal: timer.signal }),
    ]);
    return choices.filter(Boolean).slice(0, MAX_CHOICES);
  } finally {
    timer.abort();
  }
}

async function replyPrivately(interaction, content) {
  const options = { content, allowedMentions: SAFE_MENTIONS };
  if (interaction.deferred && !interaction.replied) return interaction.editReply(options);
  options.flags = MessageFlags.Ephemeral;
  if (interaction.replied || interaction.deferred) return interaction.followUp(options);
  return interaction.reply(options);
}

module.exports = async (client, interaction) => {
  const command = client.commands.get(interaction.commandName);
  const ready = client.isReady() && interaction.guild?.available;

  try {
    if (interaction.isAutocomplete()) {
      let choices = [];
      if (ready && command?.name === "end" && hasCommandPermission(client, interaction, command.permission)) {
        try {
          choices = await getEndChoicesWithinDeadline(interaction);
        } catch (error) {
          console.error("Could not load giveaway suggestions.", error.code);
        }
      }
      return await interaction.respond(choices);
    }

    if (interaction.isButton() && interaction.customId === "enterGiveaway") {
      if (!ready) return await replyPrivately(interaction, "The bot is temporarily unavailable here.");
      if (interaction.message.author?.id !== client.user.id || interaction.user.bot) return;
      return await client.util.handleGiveawayButton(interaction);
    }

    if (!interaction.isChatInputCommand() || !command) return;
    if (!ready) return await replyPrivately(interaction, "The bot is temporarily unavailable here.");
    if (!hasCommandPermission(client, interaction, command.permission)) {
      return await replyPrivately(interaction, `You need the \`${command.permission}\` permission to use this command.`);
    }

    if (command.name === "start" || command.name === "create") {
      const permissionError = getPostingPermissionError(interaction);
      if (permissionError) return await replyPrivately(interaction, permissionError);
    }
    if (command.name !== "create") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    interaction.createMessage = (options) => {
      const payload = { allowedMentions: SAFE_MENTIONS, ...options };
      if (!interaction.replied) {
        // The defer decides visibility, and Discord does not permit changing it on edit.
        delete payload.flags;
        return interaction.editReply(payload);
      }
      payload.flags ??= MessageFlags.Ephemeral;
      return interaction.followUp(payload);
    };

    const guildData = SETTINGS_COMMANDS.has(command.name)
      ? await Guild.getSettings(interaction.guildId, interaction.guild, interaction.channel)
      : undefined;
    return await command.run({ client, context: interaction, guildData });
  } catch (error) {
    console.error("Discord interaction failed.", error.code ?? error.name);
    if (!interaction.isAutocomplete() && error.code !== 10062 && error.code !== 10015) {
      await replyPrivately(interaction, "The request could not be completed.").catch(() => {});
    }
  }
};
