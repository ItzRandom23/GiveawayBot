const { randomInt } = require("node:crypto");
const { RESTJSONErrorCodes, Routes } = require("discord.js");
const GiveawayCreation = require("../models/GiveawayCreation");
const GiveawayData = require("../models/GiveawayData");
const { isSnowflake } = require("./Util");
const { logError } = require("./config");

const pollMs = 10_000;
const requestMs = 8_000;
const batchSize = 6;

async function removeDeletedChannel(guildId, channelId) {
  if (!isSnowflake(guildId) || !isSnowflake(channelId)) return;
  await Promise.all([
    GiveawayData.deleteMany({ id: guildId, channelId }),
    GiveawayCreation.updateMany({ guildId, channelId, state: "queued" }, {
      $set: { state: "failed", expiresAt: new Date(Date.now() + 86_400_000) },
      $unset: { lease: "" },
    }),
  ]);
}

async function reconcileMessage(client, giveaway) {
  const { _id, id, channelId, messageId } = giveaway;
  if (![id, channelId, messageId].every(isSnowflake)) return;
  // Claim this check so overlapping workers avoid duplicate Discord requests.
  const condition = giveaway.nextMessageCheckAt == null
    ? { nextMessageCheckAt: null }
    : { nextMessageCheckAt: giveaway.nextMessageCheckAt };
  const claim = await GiveawayData.updateOne({ _id, isActive: true, ...condition }, [{
    $set: { nextMessageCheckAt: { $add: ["$$NOW", randomInt(600_000, 1_200_000)] } },
  }], { updatePipeline: true });
  if (!claim.matchedCount) return;

  try {
    await client.rest.get(Routes.channelMessage(channelId, messageId), { signal: AbortSignal.timeout(requestMs) });
  } catch (error) {
    if ([RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.UnknownMessage].includes(error.code)) {
      await GiveawayData.deleteOne({ _id, id, channelId, messageId });
      return;
    }
    // Missing access and transport errors do not establish that the message was deleted.
    logError("Giveaway message reconciliation", error);
  }
}

function startMessageReconciliation(client) {
  let timer;
  let stopped = false;
  const check = async () => {
    try {
      if (!client.isReady()) return;
      const guildIds = [...client.guilds.cache.keys()];
      if (!guildIds.length) return;
      const giveaways = await GiveawayData.find({
        id: { $in: guildIds },
        isActive: true,
        $or: [
          { nextMessageCheckAt: null },
          { $expr: { $lte: ["$nextMessageCheckAt", "$$NOW"] } },
        ],
      }).select("id channelId messageId nextMessageCheckAt")
        .sort({ nextMessageCheckAt: 1 }).limit(batchSize).lean();
      const results = await Promise.allSettled(giveaways.map((giveaway) => reconcileMessage(client, giveaway)));
      for (const result of results) {
        if (result.status === "rejected") logError("Giveaway message reconciliation", result.reason);
      }
    } catch (error) {
      logError("Giveaway message reconciliation", error);
    } finally {
      if (!stopped) timer = setTimeout(check, pollMs).unref();
    }
  };
  void check();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

module.exports = { startMessageReconciliation, removeDeletedChannel, reconcileMessage };
