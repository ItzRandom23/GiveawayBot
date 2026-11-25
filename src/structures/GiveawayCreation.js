const { randomUUID } = require("node:crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  Routes,
  SnowflakeUtil,
} = require("discord.js");
const GiveawayCreation = require("../models/GiveawayCreation");
const GiveawayData = require("../models/GiveawayData");
const { isSnowflake } = require("./Util");
const { logError } = require("./config");

const leaseMs = 120_000;
const requestMs = 10_000;
const recoveryIntervalMs = 10_000;
const historyGraceMs = 30_000;
const finishedRetentionMs = 86_400_000;
const noMentions = { parse: [] };
const defaultEmoji = "🎉";

function setupMarker(id) {
  return "Giveaway setup " + id;
}

function editGuard(job) {
  return { _id: job._id, state: "queued", lease: job.lease };
}

function entryComponents(emoji, disabled) {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId("enterGiveaway")
    .setStyle(ButtonStyle.Primary)
    .setEmoji(emoji)
    .setDisabled(disabled)).toJSON()];
}

function setupEmbed(job, description) {
  return new EmbedBuilder()
    .setColor(job.color)
    .setTitle(job.prize)
    .setDescription(description)
    .setFooter({ text: setupMarker(job._id) })
    .toJSON();
}

function isSetupMessage(client, job, message) {
  return message?.author?.id === client.user.id &&
    message.embeds?.some((embed) => embed.footer?.text === setupMarker(job._id));
}

function expectedButton(message) {
  return message?.components?.flatMap((row) => row.components ?? [])
    .find((component) => component.custom_id === "enterGiveaway" || component.custom_id === "giveawayEnded");
}

function queued(messageId) {
  return { id: messageId, pending: true };
}

async function resultAfterLeaseLoss(job) {
  const current = await GiveawayCreation.findById(job._id, "messageId state").lean();
  if (current?.state === "failed") return { failed: true };
  if (current?.state === "done") return { id: current.messageId };
  return queued(current?.messageId ?? job.messageId);
}

async function updateClaim(job, changes, { finish, retryIn } = {}) {
  const set = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, { $literal: value }]));
  if (finish) set.expiresAt = { $add: ["$$NOW", finishedRetentionMs] };
  if (retryIn != null) set.retryAt = { $add: ["$$NOW", retryIn] };
  const steps = [{ $set: set }];
  if (finish || retryIn != null) steps.push({ $unset: ["lease"] });
  const result = await GiveawayCreation.updateOne(editGuard(job), steps, { updatePipeline: true });
  return result.matchedCount === 1;
}

async function withEntryEmoji(job, publish) {
  try {
    return await publish(job.emoji);
  } catch (error) {
    const invalidEmoji = error.code === RESTJSONErrorCodes.UnknownEmoji ||
      (error.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType &&
        JSON.stringify(error.rawError?.errors?.components ?? {}).includes('"emoji"'));
    if (!invalidEmoji || job.emoji === defaultEmoji) throw error;
    if (!await updateClaim(job, { emoji: defaultEmoji })) throw error;
    job.emoji = defaultEmoji;
    return publish(defaultEmoji);
  }
}

async function findStagedMessage(client, job) {
  const query = new URLSearchParams({ limit: "100" });
  if (job.searchBefore) query.set("before", job.searchBefore);
  const messages = await client.rest.get(Routes.channelMessages(job.channelId), {
    query,
    signal: AbortSignal.timeout(requestMs),
  });
  const match = messages.find((message) => isSetupMessage(client, job, message));
  if (match) return { match };

  if (!messages.length) {
    // Discord also returns an empty history when the bot lacks Read Message History.
    const channel = await client.channels.fetch(job.channelId, { force: true });
    const required = [PermissionFlagsBits.ReadMessageHistory];
    if (channel?.isVoiceBased?.()) required.push(PermissionFlagsBits.Connect);
    if (channel?.guildId !== job.guildId ||
        !channel.permissionsFor?.(client.user)?.has(required)) {
      const error = new Error("Cannot confirm giveaway setup without channel history");
      error.code = RESTJSONErrorCodes.MissingPermissions;
      error.status = 403;
      throw error;
    }
  }

  const oldest = messages.at(-1);
  // Search back to the first attempted send, allowing for clock differences.
  const earliest = job.sendStartedAt.getTime() - 60_000;
  if (messages.length === 100 && isSnowflake(oldest.id) &&
      SnowflakeUtil.timestampFrom(oldest.id) >= earliest && oldest.id !== job.searchBefore) {
    return { nextPage: oldest.id };
  }
  return {};
}

async function persistActiveGiveaway(job) {
  const scope = { id: job.guildId, channelId: job.channelId, messageId: job.messageId };
  const details = {
    prize: job.prize,
    hostId: job.hostId,
    winnersCount: job.winnersCount,
  };
  if (job.description) details.description = job.description;
  const set = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, { $literal: value }]));
  return GiveawayData.findOneAndUpdate(scope, [{ $set: {
    ...set,
    startTime: { $ifNull: ["$startTime", "$$NOW"] },
    endTime: { $ifNull: ["$endTime", { $add: ["$$NOW", job.seconds * 1000] }] },
    isActive: { $ifNull: ["$isActive", true] },
    participants: { $ifNull: ["$participants", []] },
    entryCount: { $ifNull: ["$entryCount", 0] },
  } }], {
    upsert: true,
    returnDocument: "after",
    updatePipeline: true,
    setDefaultsOnInsert: false,
  }).lean();
}

async function activate(client, job, message) {
  return client.util.withGiveawayMessage(job.messageId, async () => {
    const route = Routes.channelMessage(job.channelId, job.messageId);
    const current = message ?? await client.rest.get(route, { signal: AbortSignal.timeout(requestMs) });
    const button = expectedButton(current);
    if (current?.author?.id !== client.user.id || !button) {
      await updateClaim(job, { state: "failed" }, { finish: true });
      return { failed: true };
    }
    if (!isSetupMessage(client, job, current)) {
      const saved = await GiveawayData.exists({ messageId: job.messageId, id: job.guildId, channelId: job.channelId });
      await updateClaim(job, { state: saved ? "done" : "failed" }, { finish: true });
      return saved ? { id: job.messageId } : { failed: true };
    }

    if (button.disabled) {
      await withEntryEmoji(job, (emoji) => client.rest.patch(route, {
        body: {
          embeds: [setupEmbed(job, "Entries are opening…")],
          components: entryComponents(emoji, false),
          allowed_mentions: noMentions,
        },
        signal: AbortSignal.timeout(requestMs),
      }));
    }

    // Start the countdown only after Discord has enabled the entry button.
    if (!await GiveawayCreation.exists(editGuard(job))) return resultAfterLeaseLoss(job);
    const giveaway = await persistActiveGiveaway(job);
    if (giveaway.isActive) {
      await client.rest.patch(route, {
        body: { embeds: [client.util.createGiveawayEmbed(giveaway, job.color).toJSON()], allowed_mentions: noMentions },
        signal: AbortSignal.timeout(requestMs),
      });
    }
    const finished = await updateClaim(job, { state: "done" }, { finish: true });
    return finished ? { id: job.messageId } : resultAfterLeaseLoss(job);
  });
}

async function processCreation(client, id) {
  const job = await GiveawayCreation.findOneAndUpdate({
    _id: id,
    state: "queued",
    $expr: { $lte: ["$retryAt", "$$NOW"] },
  }, [{ $set: {
    lease: randomUUID(),
    retryAt: { $add: ["$$NOW", leaseMs] },
  } }], { returnDocument: "after", updatePipeline: true }).lean();
  if (!job) return queued();

  let message;
  try {
    if (!job.messageId) {
      if (job.sendStartedAt) {
        // An ambiguous POST is reconciled against history, so it is never blindly sent again.
        const { match, nextPage } = await findStagedMessage(client, job);
        if (nextPage) {
          await updateClaim(job, { searchBefore: nextPage }, { retryIn: 0 });
          return queued();
        }
        if (!match) {
          await updateClaim(job, { state: "failed" }, { finish: true });
          return { failed: true };
        }
        message = match;
      } else {
        const started = await GiveawayCreation.updateOne(editGuard(job), { $currentDate: { sendStartedAt: true } });
        if (!started.matchedCount) return resultAfterLeaseLoss(job);
        message = await withEntryEmoji(job, (emoji) => client.rest.post(Routes.channelMessages(job.channelId), {
          body: {
            embeds: [setupEmbed(job, "Preparing giveaway…")],
            components: entryComponents(emoji, true),
            allowed_mentions: noMentions,
            nonce: job._id,
            enforce_nonce: true,
          },
          signal: AbortSignal.timeout(requestMs),
        }));
      }
      job.messageId = message.id;
      if (!await updateClaim(job, { messageId: job.messageId })) return resultAfterLeaseLoss(job);
    }
    return await activate(client, job, message);
  } catch (error) {
    const missing = [RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.UnknownMessage].includes(error.code);
    const rejectedSend = !job.messageId && !job.sendStartedAt && [400, 401, 403, 404].includes(error.status);
    if (missing || rejectedSend) {
      if (missing && job.messageId) {
        await GiveawayData.deleteOne({ id: job.guildId, channelId: job.channelId, messageId: job.messageId });
      }
      await updateClaim(job, { state: "failed" }, { finish: true });
      return { failed: true };
    }
    await updateClaim(job, {}, { retryIn: error.status === 403 ? 300_000 : historyGraceMs });
    logError("Giveaway creation attempt", error);
    return queued(job.messageId);
  }
}

async function createGiveaway(client, { requestId, channel, guildData, userId, prize, description, seconds, winnersCount }) {
  if (!isSnowflake(requestId)) throw new TypeError("Giveaway creation requires a Discord interaction ID");
  const job = await GiveawayCreation.findOneAndUpdate({ _id: requestId }, { $setOnInsert: {
    guildId: channel.guildId,
    channelId: channel.id,
    hostId: userId,
    prize,
    description,
    seconds,
    winnersCount,
    color: guildData.embedColor,
    emoji: guildData.giveawayEmoji,
    state: "queued",
    retryAt: new Date(0),
  } }, { upsert: true, returnDocument: "after" }).lean();
  const result = job.state === "done" ? { id: job.messageId } :
    job.state === "failed" ? { failed: true } : await processCreation(client, job._id);
  if (result.failed) throw new Error("Giveaway setup could not be completed");
  return result;
}

async function isGiveawayOpening(guildId, channelId, messageId) {
  return Boolean(await GiveawayCreation.exists({ guildId, channelId, messageId, state: "queued" }));
}

function startCreationRecovery(client) {
  let timer;
  let stopped = false;
  const recover = async () => {
    try {
      if (!client.isReady()) return;
      const guildIds = [...client.guilds.cache.keys()];
      if (!guildIds.length) return;
      const jobs = await GiveawayCreation.find({
        guildId: { $in: guildIds },
        state: "queued",
        $expr: { $lte: ["$retryAt", "$$NOW"] },
      }).select("_id").sort({ retryAt: 1 }).limit(5).lean();
      const results = await Promise.allSettled(jobs.map(({ _id }) => processCreation(client, _id)));
      for (const result of results) {
        if (result.status === "rejected") logError("Giveaway creation recovery", result.reason);
      }
    } catch (error) {
      logError("Giveaway creation recovery", error);
    } finally {
      if (!stopped) timer = setTimeout(recover, recoveryIntervalMs).unref();
    }
  };
  void recover();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

module.exports = { createGiveaway, isGiveawayOpening, startCreationRecovery, processCreation };
