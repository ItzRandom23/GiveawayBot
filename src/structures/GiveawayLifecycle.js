const { randomBytes, randomInt, randomUUID } = require("node:crypto");
const { MessageFlags, RESTJSONErrorCodes, Routes } = require("discord.js");
const GiveawayData = require("../models/GiveawayData");
const Guild = require("../models/Guild");
const { canViewGiveaway, isSnowflake, LIMITS } = require("./Util");

const leaseMs = 120_000;
const dbTimeoutMS = 10_000;
const retryDue = { $expr: { $lte: ["$pending.retryAt", "$$NOW"] } };
const sourceFailureCodes = [
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.InvalidActionOnArchivedThread,
  RESTJSONErrorCodes.ThreadLocked,
];

const databaseDateAfter = (milliseconds) => ({ $add: ["$$NOW", milliseconds] });

async function pickWinners(client, guildId, eligible, count, renewLease) {
  const winners = [];
  let index = 0;
  let renewAfter = performance.now() + leaseMs / 4;
  while (index < eligible.length && winners.length < count) {
    if (performance.now() >= renewAfter) {
      if (!await renewLease()) return null;
      renewAfter = performance.now() + leaseMs / 4;
    }
    const batch = [];
    const size = Math.min(5, eligible.length - index, count - winners.length);
    for (let offset = 0; offset < size; offset++, index++) {
      const chosen = randomInt(index, eligible.length);
      [eligible[index], eligible[chosen]] = [eligible[chosen], eligible[index]];
      batch.push(eligible[index]);
    }
    const members = await Promise.all(batch.map(async (userId) => {
      try {
        await client.rest.get(Routes.guildMember(guildId, userId), { signal: AbortSignal.timeout(8_000) });
        return userId;
      } catch (error) {
        if (error.code !== RESTJSONErrorCodes.UnknownMember) throw error;
        return null;
      }
    }));
    winners.push(...members.filter(Boolean));
  }
  return winners;
}

function legacyWinnerIds(message, entrants) {
  const description = message.embeds[0]?.description ?? "";
  const resultLine = description.split("\n").at(-1);
  const legacyResult = /^Winners: \*\*((?:<@!?\d+>)(?:, <@!?\d+>)*)\*\*$/.exec(resultLine);
  if (!legacyResult) return [];
  return [...new Set([...legacyResult[1].matchAll(/<@!?(\d+)>/g)]
    .map((match) => match[1]).filter((id) => entrants.has(id)))];
}

async function getGiveawayMessage(client, giveaway) {
  const channel = await client.channels.fetch(giveaway.channelId, { force: true });
  // The SDK can return null after a successful GET when a guild cache entry disappears.
  if (!channel) throw new Error("Giveaway channel unavailable in this worker");
  if (channel.guildId !== giveaway.id || !channel.messages) return null;
  const message = await channel.messages.fetch({
    message: giveaway.messageId,
    force: true,
    cache: false,
  });
  if (message.author.id !== client.user.id) return null;
  const button = message.components.flatMap((row) => row.components ?? []).find(
    (component) => component.customId === "enterGiveaway" || component.customId === "giveawayEnded"
  );
  return button ? { message, button } : null;
}

function isEndedButton(button) {
  return button.customId === "giveawayEnded" && button.disabled;
}

function legacyEndTime(message) {
  return Number.isFinite(message.editedTimestamp) ? { endTime: new Date(message.editedTimestamp) } : {};
}

async function editResult(client, message, button, giveaway, winnerIds) {
  const settings = await Guild.getSettings(giveaway.id, message.guild);
  const embed = client.util.createGiveawayEmbed(giveaway, settings.embedColor, winnerIds);
  const emoji = button.emoji?.id ? button.emoji : button.emoji?.name;
  const allowedMentions = { parse: [], repliedUser: false };
  try {
    await message.edit({
      embeds: [embed],
      components: [client.util.createDisabledButtonRow(emoji)],
      allowedMentions,
    });
  } catch (error) {
    // A custom emoji can be deleted after the giveaway was posted.
    if (!emoji?.id || ![RESTJSONErrorCodes.UnknownEmoji, RESTJSONErrorCodes.InvalidFormBodyOrContentType]
      .includes(error.code)) throw error;
    await message.edit({ embeds: [embed], components: [client.util.createDisabledButtonRow()], allowedMentions });
  }
}

async function clearMissingGiveaway(filter) {
  await GiveawayData.deleteOne(filter, { timeoutMS: dbTimeoutMS });
  return { status: "missing" };
}

async function processOperation(client, scope, token, { moderatorRetry = false } = {}) {
  return client.util.withGiveawayMessage(scope.messageId, async () => {
    const attemptId = randomUUID();
    const available = moderatorRetry ? {
      "pending.sourceFailureCode": { $in: sourceFailureCodes },
      "pending.attemptId": { $exists: false },
    } : retryDue;
    const giveaway = await GiveawayData.findOneAndUpdate({
      ...scope,
      "pending.token": token,
      ...available,
    }, [{
      $set: { "pending.attemptId": attemptId, "pending.retryAt": databaseDateAfter(leaseMs) },
    }], { returnDocument: "after", updatePipeline: true, timeoutMS: dbTimeoutMS }).lean();

    if (!giveaway) return { status: "pending" };
    const { pending } = giveaway;
    const filter = { ...scope, "pending.token": token, "pending.attemptId": attemptId };
    const renewLease = async () => (await GiveawayData.updateOne(filter, [{
      $set: { "pending.retryAt": databaseDateAfter(leaseMs) },
    }], { updatePipeline: true, timeoutMS: dbTimeoutMS })).matchedCount === 1;

    try {
      const target = await getGiveawayMessage(client, giveaway);
      if (!target) return await clearMissingGiveaway(filter);
      const { message, button } = target;
      if (!await renewLease()) return { status: "pending" };

      const wasEnded = isEndedButton(button);
      const entrants = new Set((Array.isArray(giveaway.participants) ? giveaway.participants : []).filter(isSnowflake));
      if (pending.kind !== "reroll" && pending.winnerIds === undefined && wasEnded) {
        const winnerHistory = giveaway.winnerHistory ?? legacyWinnerIds(message, entrants);
        await GiveawayData.updateOne(filter, {
          $set: { winnerHistory, ...legacyEndTime(message) },
          $unset: { pending: "" },
        }, { timeoutMS: dbTimeoutMS });
        return { status: "alreadyEnded" };
      }

      if (pending.kind === "delete") {
        await message.delete();
        await GiveawayData.deleteOne(filter, { timeoutMS: dbTimeoutMS });
        return { status: "done" };
      }

      let { winnerIds } = pending;
      if (winnerIds === undefined) {
        const previousWinners = giveaway.winnerHistory ?? legacyWinnerIds(message, entrants);
        const previous = new Set(previousWinners);
        const isReroll = pending.kind === "reroll";
        const eligible = [...entrants].filter((id) => !isReroll || !previous.has(id));
        const configured = Number.isSafeInteger(giveaway.winnersCount) ? giveaway.winnersCount : 1;
        const count = pending.count ?? Math.max(1, Math.min(configured, LIMITS.maxWinners));
        winnerIds = isReroll && eligible.length < count
          ? []
          : await pickWinners(client, scope.id, eligible, Math.min(count, eligible.length), renewLease);
        if (!winnerIds) return { status: "pending" };
        if (isReroll && winnerIds.length < count) {
          await GiveawayData.updateOne(filter, { $unset: { pending: "" } }, { timeoutMS: dbTimeoutMS });
          return { status: "insufficient", count };
        }

        // Persist the draw before touching Discord so retries use exactly the same winners.
        const saved = await GiveawayData.updateOne(filter, {
          $set: { "pending.winnerIds": winnerIds, winnerHistory: previousWinners },
        }, { timeoutMS: dbTimeoutMS });
        if (saved.matchedCount !== 1) return { status: "pending" };
      }

      if (!await renewLease()) return { status: "pending" };
      await editResult(client, message, button, giveaway, winnerIds);
      // Old pending records may already have sent their reply before the database acknowledged completion.
      const shouldNotify = pending.separateAnnouncement || !wasEnded;
      const result = await GiveawayData.updateOne(filter, {
        $addToSet: { winnerHistory: { $each: winnerIds } },
        $unset: { pending: "" },
        ...(shouldNotify && { $push: { queuedAnnouncements: { token, kind: pending.kind, winnerIds } } }),
      }, { timeoutMS: dbTimeoutMS });
      return { status: result.matchedCount === 1 ? "done" : "pending" };
    } catch (error) {
      if ([RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.UnknownMessage].includes(error.code)) {
        if (pending.kind === "delete") {
          await GiveawayData.deleteOne(filter, { timeoutMS: dbTimeoutMS });
          return { status: "done" };
        }
        return clearMissingGiveaway(filter);
      }

      const delay = Math.min(3_600_000, 15_000 * 2 ** Math.min(pending.failures ?? 0, 8));
      const sourceBlocked = sourceFailureCodes.includes(error.code);
      const updates = {
        "pending.retryAt": databaseDateAfter(delay),
        "pending.failures": (pending.failures ?? 0) + 1,
        ...(sourceBlocked && { "pending.sourceFailureCode": error.code }),
      };
      const clear = sourceBlocked ? ["pending.attemptId"] : ["pending.attemptId", "pending.sourceFailureCode"];
      await GiveawayData.updateOne(filter, [{ $set: updates }, { $unset: clear }], {
        updatePipeline: true, timeoutMS: dbTimeoutMS,
      });
      console.error(`Giveaway ${pending.kind} will retry for ${scope.messageId}`, error.code ?? error.name);
      return { status: sourceBlocked ? "sourceBlocked" : "pending" };
    }
  });
}

async function postAnnouncement(client, scope, token) {
  // Consume durably before sending. A crash or ambiguous HTTP result must never trigger a second send.
  const claimed = await GiveawayData.findOneAndUpdate({
    ...scope,
    "queuedAnnouncements.token": token,
  }, {
    $pull: { queuedAnnouncements: { token } },
  }, { returnDocument: "before", timeoutMS: dbTimeoutMS }).select("queuedAnnouncements").lean();
  const announcement = claimed?.queuedAnnouncements.find((item) => item.token === token);
  if (!announcement) return;

  const winnerIds = announcement.winnerIds;
  const mentions = winnerIds.map((id) => `<@${id}>`).join(", ");
  let content = "No valid entrants, so a winner could not be determined!";
  if (winnerIds.length) {
    content = announcement.kind === "reroll"
      ? `New giveaway winners: ${mentions}!`
      : `Congratulations ${mentions}! You won this giveaway!`;
  }
  try {
    await client.rest.post(Routes.channelMessages(scope.channelId), { signal: AbortSignal.timeout(10_000), body: {
      content,
      allowed_mentions: { parse: [], users: winnerIds, replied_user: false },
      flags: MessageFlags.SuppressEmbeds,
      message_reference: { message_id: scope.messageId, fail_if_not_exists: true },
      nonce: token,
      enforce_nonce: true,
    } });
  } catch (error) {
    console.error(`Could not confirm giveaway notification for ${scope.messageId}`, error.code ?? error.name);
  }
}

async function queueOperation(client, scope, kind, { count, automatic = false, legacyEnd } = {}) {
  const token = randomBytes(12).toString("hex");
  const pending = { kind, token, retryAt: "$$NOW", separateAnnouncement: true, failures: 0 };
  if (count !== undefined) pending.count = count;
  const state = { isActive: false, pending, ...legacyEnd };
  if (kind === "end" && !automatic) state.endTime = "$$NOW";

  const result = await GiveawayData.updateOne({
    ...scope,
    isActive: kind !== "reroll" || Boolean(legacyEnd),
    pending: { $exists: false },
    ...(automatic && { endTime: { $type: "date" }, $expr: { $lte: ["$endTime", "$$NOW"] } }),
  }, [{ $set: state }], { updatePipeline: true, timeoutMS: dbTimeoutMS });
  if (result.matchedCount !== 1) return { status: "changed" };

  return processOperation(client, scope, token);
}

async function runGiveawayOperation({ client, context }, kind, count) {
  const messageId = context.options.getString("giveaway_id", true).trim();
  const reply = (content) => context.createMessage({ content, flags: MessageFlags.Ephemeral });
  const notFound = kind === "reroll"
    ? "I couldn't find an ended giveaway you can view with that message ID."
    : "I couldn't find an active giveaway you can view with that message ID.";
  if (!isSnowflake(messageId)) return reply(notFound);

  const query = { id: context.guildId, messageId };
  const giveaway = await GiveawayData.findOne(query, "channelId isActive pending.token pending.kind pending.sourceFailureCode pending.attemptId")
    .setOptions({ timeoutMS: dbTimeoutMS }).lean();
  if (!giveaway || !await canViewGiveaway(context, giveaway.channelId)) return reply(notFound);

  const scope = { ...query, channelId: giveaway.channelId };
  const sourceBlocked = (name) => reply(
    `I couldn't update the giveaway post. Restore my access and message permissions in <#${scope.channelId}>, or reopen its thread, then run \`/${name}\` with message ID \`${messageId}\`.`
  );
  let result;
  if (giveaway.pending) {
    const pending = giveaway.pending;
    if (!pending.sourceFailureCode) return reply("This giveaway already has an update in progress.");
    if (pending.kind !== kind) return sourceBlocked(pending.kind);
    if (pending.attemptId) return reply("I am already retrying the update for this giveaway.");
    result = await processOperation(client, scope, pending.token, { moderatorRetry: true });
  } else {
    let legacyEnd;
    if (giveaway.isActive && kind === "reroll") {
      const target = await getGiveawayMessage(client, scope).catch(() => null);
      if (!target || !isEndedButton(target.button)) return reply(notFound);
      // The upstream manual /end command could update Discord without closing the database record.
      legacyEnd = legacyEndTime(target.message);
    } else if (giveaway.isActive !== (kind !== "reroll")) {
      return reply(notFound);
    }
    result = await queueOperation(client, scope, kind, { count, legacyEnd });
  }
  if (result.status === "missing") return reply("The giveaway message or channel is unavailable.");
  if (result.status === "alreadyEnded") return reply("The giveaway had already ended.");
  if (result.status === "sourceBlocked") return sourceBlocked(kind);
  if (result.status === "pending") {
    return reply("The giveaway update is queued. Check the giveaway post for the result.");
  }
  if (result.status === "changed") return reply("The giveaway changed while your request was processed.");
  if (result.status === "insufficient") {
    return reply(`There aren't enough eligible entrants to select ${result.count} new winners.`);
  }

  const success = {
    end: `The giveaway has ended. The results were posted in <#${giveaway.channelId}>.`,
    delete: "The giveaway was deleted.",
    reroll: `New winners are shown on the giveaway in <#${giveaway.channelId}>.`,
  };
  return reply(success[kind]);
}

async function removeDeletedGiveaways(guildId, channelId, messageIds) {
  if (!isSnowflake(guildId) || !isSnowflake(channelId)) return;
  const ids = [...messageIds].filter(isSnowflake);
  if (!ids.length) return;
  await GiveawayData.deleteMany({ id: guildId, channelId, messageId: { $in: ids } });
}

module.exports = { postAnnouncement, processOperation, queueOperation, removeDeletedGiveaways, runGiveawayOperation };
