const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Message,
} = require("discord.js");
const data = require("../models/Guild");
const gwdata = require("../models/GiveawayData");

class Util {
  /**
   * @param {import('./Client')} client
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * Handles giveaway button interaction
   * @param {import('discord.js').ButtonInteraction} interaction
   * @param {string} giveawayId
   */
  async handleGiveawayButton(interaction, giveawayId) {
    const GiveawayData = await gwdata.findOne({ messageId: giveawayId });
    if (!GiveawayData) {
      return interaction.reply({
        content: "Giveaway not found!",
        flags: 64,
      });
    }

    const guildSettings = await data.findOne({ id: interaction.guildId }) || {};
    const userId = interaction.user.id;
    const isParticipating = GiveawayData.participants.includes(userId);
    const update = isParticipating
      ? { $pull: { participants: userId }, $inc: { entryCount: -1 } }
      : { $push: { participants: userId }, $inc: { entryCount: 1 } };

    const updatedGiveawayData = await gwdata.findOneAndUpdate(
      { messageId: giveawayId },
      update,
      { new: true }
    );

    await interaction.reply({
      content: isParticipating
        ? "You have left the giveaway!"
        : "You have entered the giveaway!",
      flags: 64,
    });

    this.updateGiveawayEmbed(
      giveawayId,
      updatedGiveawayData,
      guildSettings.embedColor || "#0000FF"
    );
  }

  async updateGiveawayEmbed(giveawayId, GiveawayData, embedColor = "#0000FF") {
    try {
      const { channelId } = GiveawayData._doc || GiveawayData;
      if (!channelId) {
        console.error(`Channel ID is undefined for giveaway ${giveawayId}`);
        return;
      }

      const channel = await this.client.channels.fetch(channelId);
      const message = await channel.messages.fetch(giveawayId);
      const embed = this.createGiveawayEmbed(GiveawayData, embedColor);
      await message.edit({ embeds: [embed] });
    } catch (error) {
      console.error(`Failed to update giveaway embed ${giveawayId}:`, error);
    }
  }

  async fetchMessageByApi(client, channelId, messageId) {
    try {
      const response = await client.rest.get(
        `/channels/${channelId}/messages/${messageId}`
      );
      return new Message(client, response, client.channels.cache.get(channelId));
    } catch (error) {
      console.log(
        error.message?.includes("Unknown Message")
          ? `Message ${messageId} no longer exists`
          : `Error fetching message ${messageId}: ${error}`
      );
      return null;
    }
  }

  async checkGiveawayEnd(giveawayId) {
    const GiveawayData = await gwdata.findOne({ messageId: giveawayId });
    if (!GiveawayData?.isActive) return;
    if (Date.now() < GiveawayData.endTime) return;

    const channel = await this.client.channels.fetch(GiveawayData.channelId).catch(() => null);
    if (!channel) return;

    const message = await this.fetchMessageByApi(this.client, GiveawayData.channelId, giveawayId);
    if (!message) return;

    await gwdata.updateOne({ messageId: giveawayId }, { isActive: false });
    await this.endGiveawayEmbed(giveawayId, GiveawayData);
  }

  createGiveawayEmbed(GiveawayData, color, winners = "") {
    const { prize, endTime, hostId, entryCount, winnersCount } = GiveawayData._doc || GiveawayData;

    if (!prize || !endTime || !hostId) {
      console.error("Invalid GiveawayData structure:", GiveawayData);
      return new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("Error: Invalid Giveaway Data")
        .setDescription("There was an issue retrieving giveaway details.");
    }

    const endTimestamp = Math.floor(endTime / 1000);

    return new EmbedBuilder()
      .setColor(color)
      .setTitle(`**${prize}**`)
      .setDescription(
        `Ends: <t:${endTimestamp}:R> (<t:${endTimestamp}:f>)\n` +
        `Hosted by: <@${hostId}>\n` +
        `Entries: **${entryCount ?? 0}**\n` +
        `Winners: **${winners || winnersCount}**`
      )
      .setTimestamp();
  }

  createDisabledButtonRow(giveawayEmoji = "🎉") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("giveawayEnded")
        .setStyle(ButtonStyle.Primary)
        .setEmoji(giveawayEmoji)
        .setDisabled(true)
    );
  }

  async endGiveawayEmbed(giveawayId, GiveawayData) {
    try {
      const channel = await this.client.channels.fetch(GiveawayData.channelId);
      const message = await channel.messages.fetch(giveawayId);

      const guildSettings = await data.findOne({ id: message.guildId }) || {};
      const winnersData = this.getWinners(GiveawayData);

      const embed = this.createGiveawayEmbed(
        GiveawayData,
        guildSettings.embedColor || "#313338",
        winnersData.winners
      );
      const row = this.createDisabledButtonRow(guildSettings.giveawayEmoji || "🎉");

      await message.edit({ embeds: [embed], components: [row] });
      await message.reply({
        content: winnersData.winners
          ? `Congratulations ${winnersData.winners}! You won **${GiveawayData.prize}**!`
          : "No valid entrants, so a winner could not be determined!",
      });
    } catch (error) {
      console.error(`Failed to end giveaway ${giveawayId}:`, error);
    }
  }

  async rerollGiveawayEmbed(giveawayId, GiveawayData, winnersToPick) {
    try {
      const channel = await this.client.channels.fetch(GiveawayData.channelId);
      const message = await channel.messages.fetch(giveawayId);

      const guildSettings = await data.findOne({ id: message.guildId }) || {};
      const winnersData = this.getWinners(GiveawayData, winnersToPick);

      const embed = this.createGiveawayEmbed(
        GiveawayData,
        guildSettings.embedColor || "#313338",
        winnersData.winners
      );
      const row = this.createDisabledButtonRow(guildSettings.giveawayEmoji || "🎉");

      await message.edit({ embeds: [embed], components: [row] });
      await message.reply({
        content: winnersData.winners
          ? `Rerolled the giveaway! New winner(s) are ${winnersData.winners}!`
          : "No valid entrants, so a winner could not be determined!",
      });
    } catch (error) {
      console.error(`Failed to reroll giveaway ${giveawayId}:`, error);
    }
  }

  getWinners(GiveawayData, winnersToPick) {
    if (!GiveawayData.participants.length) return { winners: "" };

    const count = Math.min(
      winnersToPick || GiveawayData.winnersCount,
      GiveawayData.participants.length
    );

    const winnerIds = GiveawayData.participants
      .sort(() => Math.random() - 0.5)
      .slice(0, count);

    return { winners: winnerIds.map((id) => `<@${id}>`).join(", ") };
  }

  async parseDuration(duration) {
    duration = duration.trim();

    const timeRegex = /^(\d+)(s|m|h|d)$/;
    const match = duration.match(timeRegex);

    if (!match) {
      console.log(`Invalid duration value: ${duration}`);
      return null;
    }

    const amount = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case "s":
        return amount; // seconds
      case "m":
        return amount * 60; // minutes to seconds
      case "h":
        return amount * 3600; // hours to seconds
      case "d":
        return amount * 86400; // days to seconds
      default:
        return null;
    }
  }

  /**
    *
    * @param {import("discord.js").Interaction | import("discord.js").Message} context
    * @param {Array<EmbedBuilder>} embeds
    */

  async paginate(context, embeds) {
    let currentPage = 0;
    const message =
      context instanceof Message ? await context.channel.send({
        embeds: [
          embeds[currentPage]
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setStyle(ButtonStyle.Primary)
              .setCustomId("1")
              .setEmoji({ name: "⏮️" })
              .setDisabled(true),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Secondary)
              .setCustomId("2")
              .setEmoji({ name: "⏪" })
              .setDisabled(true),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Secondary)
              .setCustomId("3")
              .setEmoji({ name: "⏩" }),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Primary)
              .setCustomId("4")
              .setEmoji({ name: "⏭️" })
          ),
        ],
      })
        : await context.followUp({
          embeds: [
            embeds[currentPage]
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Primary)
                .setCustomId("1")
                .setEmoji({ name: "⏮️" })
                .setDisabled(true),
              new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setCustomId("2")
                .setEmoji({ name: "⏪" })
                .setDisabled(true),
              new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setCustomId("3")
                .setEmoji({ name: "⏩" }),
              new ButtonBuilder()
                .setStyle(ButtonStyle.Primary)
                .setCustomId("4")
                .setEmoji({ name: "⏭️" })
            ),
          ],
        });
    const collector = message.createMessageComponentCollector({
      time: 300000,
      filter: ({ member: { id: memberId } }) => memberId === context.member.id,
    });
    collector.on("collect",
      /**
       * 
       * @param {import('discord.js').ButtonInteraction} interaction
       * @returns 
       */
      async (interaction) => {
        switch (interaction.customId) {
          case "1": {
            await interaction.deferUpdate();
            currentPage = 0;
            return message.edit({
              embeds: [
                embeds[currentPage]
              ],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("1")
                    .setEmoji({ name: "⏮️" })
                    .setDisabled(true),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("2")
                    .setEmoji({ name: "⏪" })
                    .setDisabled(true),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("3")
                    .setEmoji({ name: "⏩" }),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("4")
                    .setEmoji({ name: "⏭️" })
                ),
              ],
            });
          }
          case "2": {
            await interaction.deferUpdate();
            --currentPage;
            return message.edit({
              embeds: [
                embeds[currentPage]
              ],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("1")
                    .setEmoji({ name: "⏮️" })
                    .setDisabled(currentPage === 0),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("2")
                    .setEmoji({ name: "⏪" })
                    .setDisabled(currentPage === 0),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("3")
                    .setEmoji({ name: "⏩" })
                    .setDisabled(false),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("4")
                    .setEmoji({ name: "⏭️" })
                    .setDisabled(false)
                ),
              ],
            });
          }
          case "3": {
            await interaction.deferUpdate();
            currentPage++;
            return message.edit({
              embeds: [
                embeds[currentPage]
              ],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("1")
                    .setEmoji({ name: "⏮️" })
                    .setDisabled(false),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("2")
                    .setEmoji({ name: "⏪" })
                    .setDisabled(false),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("3")
                    .setEmoji({ name: "⏩" })
                    .setDisabled(currentPage === embeds.length - 1),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("4")
                    .setEmoji({ name: "⏭️" })
                    .setDisabled(currentPage === embeds.length - 1)
                ),
              ],
            });
          }
          case "4": {
            await interaction.deferUpdate();
            currentPage = embeds.length - 1;
            return message.edit({
              embeds: [
                embeds[currentPage]
              ],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("1")
                    .setEmoji({ name: "⏮️" }),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("2")
                    .setEmoji({ name: "⏪" }),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("3")
                    .setEmoji({ name: "⏩" })
                    .setDisabled(true),
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("4")
                    .setEmoji({ name: "⏭️" })
                    .setDisabled(true)
                ),
              ],
            });
          }
        }
      });
    collector.on("end", () => {
      return message
        .edit({
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Primary)
                .setCustomId("1")
                .setEmoji({ name: "⏮️" })
                .setDisabled(true),
              new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setCustomId("2")
                .setEmoji({ name: "⏪" })
                .setDisabled(true),
              new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setCustomId("3")
                .setEmoji({ name: "⏩" })
                .setDisabled(true),
              new ButtonBuilder()
                .setStyle(ButtonStyle.Primary)
                .setCustomId("4")
                .setEmoji({ name: "⏭️" })
                .setDisabled(true)
            ),
          ],
        })
        .catch(() => null);
    });
  }

}
module.exports = Util;
