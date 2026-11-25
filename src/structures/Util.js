const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} = require("discord.js");
const Guild = require("../models/Guild");
const GiveawayData = require("../models/GiveawayData");

const LIMITS = {
  maxPrizeLength: 200,
  maxDescriptionLength: 3500,
  maxWinners: 20,
  maxDurationSeconds: 365 * 86400,
};
const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86400 };
const SAFE_MENTIONS = { parse: [], repliedUser: false };
const ENTRY_REFRESH_DELAY_MS = 250;
const MAX_ENTRY_REFRESH_RETRIES = 4;
const VIEW_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

function messageViewPermissions(channel) {
  return channel?.isVoiceBased?.() ? [...VIEW_PERMISSIONS, PermissionFlagsBits.Connect] : VIEW_PERMISSIONS;
}

const PAGE_BUTTONS = [
  { id: "giveaway-list:first", emoji: "⏮️", style: ButtonStyle.Primary },
  { id: "giveaway-list:previous", emoji: "⏪", style: ButtonStyle.Secondary },
  { id: "giveaway-list:next", emoji: "⏩", style: ButtonStyle.Secondary },
  { id: "giveaway-list:last", emoji: "⏭️", style: ButtonStyle.Primary },
];

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).replace(/[\uD800-\uDBFF]$/u, "") + "…";
}

function hasCommandPermission(client, interaction, permission) {
  return (
    !permission ||
    interaction.memberPermissions?.has(PermissionFlagsBits[permission]) ||
    client.owners?.includes(interaction.user.id)
  );
}

function getPostingPermissionError(interaction) {
  const channel = interaction.channel;
  if (typeof channel?.send !== "function") {
    return "Giveaways must be created in a channel that supports messages.";
  }
  const sendPermission = channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;
  if (
    !interaction.appPermissions?.has([
      ...messageViewPermissions(channel),
      sendPermission,
      PermissionFlagsBits.EmbedLinks,
    ])
  ) {
    return channel.isVoiceBased?.()
      ? "I need View Channel, Connect, Read Message History, Embed Links, and permission to send messages here."
      : "I need View Channel, Read Message History, Embed Links, and permission to send messages here.";
  }
  return null;
}

function getChannelVisibility(interaction, channel) {
  if (!channel || channel.guildId !== interaction.guildId) return false;
  const permissions = channel.permissionsFor?.(interaction.member ?? interaction.user.id);
  if (!permissions?.has(messageViewPermissions(channel))) return false;
  if (
    channel.type === ChannelType.PrivateThread &&
    !permissions.has(PermissionFlagsBits.ManageThreads)
  ) {
    return null;
  }
  return true;
}

async function canViewGiveaway(interaction, channelId, { force = false } = {}) {
  if (!isSnowflake(channelId) || !interaction.guild) return false;
  if (channelId === interaction.channelId) {
    return Boolean(interaction.memberPermissions?.has(messageViewPermissions(interaction.channel)));
  }
  const channel = await interaction.guild.channels.fetch(channelId, { force }).catch(() => null);
  if (force && channel?.isThread?.() && channel.parentId) {
    // Thread permissions are inherited from the parent, not the thread response.
    const parent = await interaction.guild.channels.fetch(channel.parentId, { force: true }).catch(() => null);
    if (!parent) return false;
  }
  const visibility = getChannelVisibility(interaction, channel);
  if (visibility !== null) return visibility;

  // Private thread membership is separate from its inherited permissions.
  const member = await channel.members
    .fetch({ member: interaction.user.id, force: true })
    .catch(() => null);
  return Boolean(member);
}

function getAutocompleteChannels(interaction) {
  const channels = new Map();
  if (interaction.memberPermissions?.has(messageViewPermissions(interaction.channel))) {
    channels.set(interaction.channelId, true);
  }
  for (const channel of interaction.guild.channels.cache.values()) {
    if (channel.id === interaction.channelId) continue;
    const visibility = getChannelVisibility(interaction, channel);
    if (visibility !== false) {
      channels.set(channel.id, channel.type === ChannelType.PrivateThread ? null : visibility);
    }
  }
  return channels;
}

function activeGiveawayFilter(guildId) {
  return {
    id: guildId,
    isActive: true,
    endTime: { $type: "date" },
    $expr: { $gt: ["$endTime", "$$NOW"] },
  };
}

function shouldRetryEntryRefresh(error) {
  if ([
    RESTJSONErrorCodes.UnknownMessage,
    RESTJSONErrorCodes.UnknownChannel,
    RESTJSONErrorCodes.MissingAccess,
    RESTJSONErrorCodes.MissingPermissions,
  ].includes(error.code)) return false;
  return !Number.isInteger(error.status) || error.status === 429 || error.status >= 500;
}

class Util {
  constructor(client) {
    this.client = client;
    this.messageOperations = new Map();
    this.entryRefreshes = new Map();
  }

  async withGiveawayMessage(giveawayId, operation) {
    const previous = this.messageOperations.get(giveawayId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.messageOperations.set(giveawayId, current);
    try {
      return await current;
    } finally {
      if (this.messageOperations.get(giveawayId) === current) {
        this.messageOperations.delete(giveawayId);
      }
    }
  }

  parseDuration(duration) {
    const match = /^(\d+)([smhd])$/i.exec(duration.trim());
    if (!match) return null;
    const seconds = Number(match[1]) * SECONDS_PER_UNIT[match[2].toLowerCase()];
    return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= LIMITS.maxDurationSeconds
      ? seconds
      : null;
  }

  createGiveawayEmbed(giveaway, color, winners) {
    const { prize, description, startTime, endTime, hostId, winnersCount } = giveaway;
    const endTimestamp = Math.floor(new Date(endTime).getTime() / 1000);
    const entries = Array.isArray(giveaway.participants)
      ? new Set(giveaway.participants).size
      : giveaway.entryCount ?? 0;
    const finished = winners !== undefined;
    const winnerLabel = finished
      ? winners.slice(0, LIMITS.maxWinners).map((id) => `<@${id}>`).join(", ") || "No valid entrants"
      : `**${winnersCount}**`;
    const details = [
      `${finished ? "Ended" : "Ends"}: <t:${endTimestamp}:R> (<t:${endTimestamp}:f>)`,
      `Hosted by: <@${hostId}>`,
      `Entries: **${entries}**`,
      `Winners: ${winnerLabel}`,
    ].join("\n");
    const descriptionLimit = Math.min(LIMITS.maxDescriptionLength, 4096 - details.length - 2);
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(truncate(prize, 256) || "Giveaway")
      .setDescription(description ? `${truncate(description, descriptionLimit)}\n\n${details}` : details);
    if (startTime) embed.setTimestamp(new Date(startTime));
    return embed;
  }

  createDisabledButtonRow(emoji = "🎉") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("giveawayEnded")
        .setStyle(ButtonStyle.Primary)
        .setEmoji(emoji)
        .setDisabled(true)
    );
  }

  async createGiveaway(options) {
    const { createGiveaway } = require("./GiveawayCreation");
    return createGiveaway(this.client, options);
  }

  queueEntryRefresh(scope, { message, guild }) {
    const { messageId } = scope;
    const existing = this.entryRefreshes.get(messageId);
    if (existing) {
      existing.dirty = true;
      return;
    }

    const refresh = { dirty: true, failures: 0 };
    this.entryRefreshes.set(messageId, refresh);

    const run = async () => {
      try {
        const isActive = await this.withGiveawayMessage(messageId, async () => {
          // Include entries that were committed while the refresh waited for the lock.
          refresh.dirty = false;
          const latest = await GiveawayData.findOne(scope)
            .select("prize description startTime endTime hostId winnersCount entryCount").lean();
          if (!latest) return false;
          if (latest.entryCount === refresh.lastCount) return true;
          const settings = await Guild.getSettings(scope.id, guild, message.channel);
          await message.edit({
            embeds: [this.createGiveawayEmbed(latest, settings.embedColor)],
            allowedMentions: SAFE_MENTIONS,
          });
          refresh.lastCount = latest.entryCount;
          return true;
        });
        refresh.failures = 0;
        if (isActive && refresh.dirty) {
          setTimeout(run, ENTRY_REFRESH_DELAY_MS).unref();
          return;
        }
      } catch (error) {
        if (shouldRetryEntryRefresh(error) && refresh.failures < MAX_ENTRY_REFRESH_RETRIES) {
          refresh.failures += 1;
          // Backoff happens outside the lock so ending the giveaway sees no retry backlog.
          setTimeout(run, ENTRY_REFRESH_DELAY_MS * 2 ** refresh.failures).unref();
          return;
        }
        console.error(`Could not update giveaway entry count for ${messageId}.`, error.code ?? error.name);
      }
      this.entryRefreshes.delete(messageId);
    };

    setTimeout(run, ENTRY_REFRESH_DELAY_MS).unref();
  }

  async handleGiveawayButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;
    const scope = {
      ...activeGiveawayFilter(interaction.guildId),
      channelId: interaction.channelId,
      messageId: interaction.message.id,
    };
    // Both the participant toggle and its count are computed from the same document version.
    const participants = { $ifNull: ["$participants", []] };
    const updated = await GiveawayData.findOneAndUpdate(
      scope,
      [
        {
          $set: {
            participants: {
              $cond: [
                { $in: [userId, participants] },
                { $setDifference: [participants, [userId]] },
                { $setUnion: [participants, [userId]] },
              ],
            },
          },
        },
        { $set: { entryCount: { $size: "$participants" } } },
      ],
      { returnDocument: "before", updatePipeline: true }
    ).select({ _id: 0, participants: { $elemMatch: { $eq: userId } } }).lean();

    if (!updated) {
      const { isGiveawayOpening } = require("./GiveawayCreation");
      const opening = await isGiveawayOpening(scope.id, scope.channelId, scope.messageId);
      return interaction.editReply(opening
        ? "This giveaway is still opening. Try again in a moment."
        : "This giveaway is closed or no longer exists.");
    }

    this.queueEntryRefresh(scope, interaction);
    return interaction.editReply(updated.participants?.length
      ? "You have left the giveaway!"
      : "You have entered the giveaway!");
  }

  async paginate(context, pageCount, renderPage) {
    const firstPage = await renderPage(0, context);
    if (pageCount === 1) return context.createMessage(firstPage);

    let currentPage = 0;
    let pendingEdit = Promise.resolve();
    const lastPage = pageCount - 1;
    const componentsForPage = () => [
      new ActionRowBuilder().addComponents(
        PAGE_BUTTONS.map(({ id, emoji, style }, index) =>
          new ButtonBuilder()
            .setCustomId(id)
            .setStyle(style)
            .setEmoji(emoji)
            .setDisabled(index < 2 ? currentPage === 0 : currentPage === lastPage)
        )
      ),
    ];
    const message = await context.createMessage({
      ...firstPage,
      components: componentsForPage(),
    });
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60_000,
      filter: (interaction) =>
        interaction.user.id === context.user.id &&
        PAGE_BUTTONS.some(({ id }) => id === interaction.customId),
    });

    collector.on("collect", (interaction) => {
      const acknowledged = interaction.deferUpdate().catch(() => false);
      pendingEdit = pendingEdit
        .then(async () => {
          if ((await acknowledged) === false) return;
          switch (interaction.customId) {
            case "giveaway-list:first":
              currentPage = 0;
              break;
            case "giveaway-list:previous":
              currentPage = Math.max(0, currentPage - 1);
              break;
            case "giveaway-list:next":
              currentPage = Math.min(lastPage, currentPage + 1);
              break;
            case "giveaway-list:last":
              currentPage = lastPage;
          }
          const page = await renderPage(currentPage, interaction);
          await interaction.editReply({
            ...page,
            components: componentsForPage(),
          });
        })
        .catch((error) => console.error("Could not change the giveaway list page.", error.code));
    });
    collector.on("end", () => {
      pendingEdit.then(() => context.editReply({ components: [] })).catch(() => {});
    });
    return message;
  }
}

module.exports = Util;
module.exports.LIMITS = LIMITS;
module.exports.SAFE_MENTIONS = SAFE_MENTIONS;
module.exports.activeGiveawayFilter = activeGiveawayFilter;
module.exports.canViewGiveaway = canViewGiveaway;
module.exports.getAutocompleteChannels = getAutocompleteChannels;
module.exports.getPostingPermissionError = getPostingPermissionError;
module.exports.hasCommandPermission = hasCommandPermission;
module.exports.isSnowflake = isSnowflake;
module.exports.truncate = truncate;
