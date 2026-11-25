const GiveawayData = require("../models/GiveawayData");
const { postAnnouncement, processOperation, queueOperation } = require("../structures/GiveawayLifecycle");

const pollIntervalMs = 5000;
const refillIntervalMs = 200;
const parallelOperations = 5;
const dbTimeoutMS = 10_000;

async function getMongoTime() {
  const hello = await GiveawayData.db.db.command({ hello: 1 }, { timeoutMS: dbTimeoutMS });
  return hello.localTime;
}

function startLane(client, findJobs, handleJob) {
  const inFlight = new Set();
  let timer;
  let stopped = false;
  let checking = false;
  let refill = false;

  const schedule = (delay) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(check, delay).unref();
  };

  const check = async () => {
    checking = true;
    refill = false;
    try {
      if (!client.isReady() || inFlight.size >= parallelOperations) return;
      const guildIds = [...client.guilds.cache.values()]
        .filter((guild) => guild.available !== false).map((guild) => guild.id);
      if (!guildIds.length) return;

      const scope = { id: { $in: guildIds }, messageId: { $nin: [...inFlight] } };
      const limit = parallelOperations - inFlight.size;
      const jobs = await findJobs(scope, limit);
      if (stopped) return;

      for (const job of jobs) {
        inFlight.add(job.messageId);
        void Promise.resolve().then(() => handleJob(job))
          .then(() => {
            if (checking) refill = true;
            else schedule(refillIntervalMs);
          }, (error) => console.error("Giveaway worker failed", error.code ?? error.name))
          .finally(() => inFlight.delete(job.messageId));
      }
    } catch (error) {
      console.error("Failed to query giveaways", error.code ?? error.name);
    } finally {
      checking = false;
      schedule(refill ? refillIntervalMs : pollIntervalMs);
    }
  };

  void check();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function findJobs(filter, projection, sort, limit) {
  return GiveawayData.find(filter, projection)
    .sort(sort).limit(limit).setOptions({ timeoutMS: dbTimeoutMS }).lean();
}

module.exports = (client) => {
  const stopDue = startLane(client,
    async (scope, limit) => findJobs({ ...scope, isActive: true, endTime: { $lte: await getMongoTime() } },
      "id channelId messageId", { endTime: 1, messageId: 1 }, limit),
    (scope) => queueOperation(client, scope, "end", { automatic: true }));

  const stopRetries = startLane(client,
    async (scope, limit) => findJobs({ ...scope, "pending.retryAt": { $lte: await getMongoTime() } },
      "id channelId messageId pending.token", { "pending.retryAt": 1, messageId: 1 }, limit),
    ({ pending, ...scope }) => processOperation(client, scope, pending.token));

  const stopAnnouncements = startLane(client,
    (scope, limit) => findJobs({ ...scope, "queuedAnnouncements.0": { $exists: true } },
      "id channelId messageId queuedAnnouncements.token", { _id: 1 }, limit),
    ({ queuedAnnouncements, ...scope }) => postAnnouncement(client, scope, queuedAnnouncements[0].token));

  return () => {
    stopDue();
    stopRetries();
    stopAnnouncements();
  };
};
