const { EmbedBuilder, escapeMarkdown } = require("discord.js");
const GiveawayData = require("../../models/GiveawayData");
const { activeGiveawayFilter, canViewGiveaway, isSnowflake, truncate } = require("../../structures/Util");

const fields = "prize endTime channelId messageId";
const maxDescriptionLength = 4096;

function formatEntry(giveaway, guildId, position) {
  const prize = escapeMarkdown(
    truncate(giveaway.prize || "Giveaway", 200).replace(/\s+/g, " "),
    { maskedLink: true }
  );
  const link = `https://discord.com/channels/${guildId}/${giveaway.channelId}/${giveaway.messageId}`;
  return `\`${position}.\` ${prize} • [Open](${link}) • Ends <t:${Math.floor(giveaway.endTime.getTime() / 1000)}:R>`;
}

function visibleChannels(interaction, options) {
  const checks = new Map();
  return (channelId) => {
    if (!checks.has(channelId)) {
      checks.set(channelId, canViewGiveaway(interaction, channelId, options));
    }
    return checks.get(channelId);
  };
}

module.exports = {
  name: "list",
  description: "Lists active giveaways in the server",
  permission: "ViewChannel",

  async run({ client, context, guildData }) {
    const active = activeGiveawayFilter(context.guildId);
    const giveaways = GiveawayData.find(active)
      .select(fields)
      .sort({ endTime: 1, messageId: 1 })
      .lean()
      .cursor();
    const canView = visibleChannels(context);
    const pages = [];
    let page = [];
    let pageLength = 0;
    let position = 0;
    for await (const giveaway of giveaways) {
      const { channelId, messageId } = giveaway;
      if (!isSnowflake(messageId) || !isSnowflake(channelId) || !await canView(channelId)) continue;
      const line = formatEntry(giveaway, context.guildId, ++position);
      if (page.length >= 10 || pageLength + line.length + 1 > maxDescriptionLength) {
        pages.push(page);
        page = [];
        pageLength = 0;
      }
      page.push({ messageId, position });
      pageLength += line.length + 1;
    }
    if (page.length) pages.push(page);
    if (!pages.length) return context.createMessage({ content: "There are no active giveaways you can view." });

    const title = truncate(`${context.guild.name}'s Active Giveaways`, 256);
    return client.util.paginate(context, pages.length, async (index, interaction) => {
      const items = pages[index];
      const rows = await GiveawayData.find({
        ...active,
        messageId: { $in: items.map(({ messageId }) => messageId) },
      }).select(fields).lean();
      const byMessage = new Map(rows.map((row) => [row.messageId, row]));
      const canStillView = visibleChannels(interaction, { force: true });
      const lines = await Promise.all(items.map(async ({ messageId, position }) => {
        const giveaway = byMessage.get(messageId);
        if (!giveaway || !await canStillView(giveaway.channelId)) return null;
        return formatEntry(giveaway, context.guildId, position);
      }));
      const description = lines.filter(Boolean).join("\n");
      if (!description) {
        return { content: "There are no active giveaways you can view on this page.", embeds: [] };
      }
      const embed = new EmbedBuilder()
        .setColor(guildData.embedColor)
        .setAuthor({ name: title })
        .setDescription(truncate(description, maxDescriptionLength));
      if (pages.length > 1) embed.setFooter({ text: `Page ${index + 1} of ${pages.length}` });
      return { content: null, embeds: [embed] };
    });
  },
};
