const { join } = require("node:path");
const { ClusterManager, ReClusterManager } = require("discord-hybrid-sharding");
const { Routes } = require("discord.js");
const { loadConfig, logError } = require("./structures/config");

async function discoverShardCount(token) {
  const response = await fetch(`https://discord.com/api/v10${Routes.gatewayBot()}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) {
    const error = new Error("Discord gateway discovery failed");
    error.code = response.status;
    throw error;
  }
  const result = await response.json();
  if (!Number.isSafeInteger(result?.shards) || result.shards < 1) {
    const error = new Error("Discord returned an invalid shard count");
    error.code = "INVALID_SHARD_COUNT";
    throw error;
  }
  return result.shards;
}

function stopClusters(manager) {
  manager.respawn = false;
  manager.queue.stop();
  manager.queue.queue.length = 0;
  for (const cluster of manager.clusters.values()) cluster.kill();
}

function monitorClusters(manager, onExhausted) {
  manager.on("error", (error) => logError("Cluster manager", error));
  manager.on("clusterCreate", (cluster) => {
    cluster.on("error", (error) => logError("Cluster #" + cluster.id, error));
    cluster.on("death", () => {
      // The manager emits death before checking the remaining restart budget.
      if (!manager.respawn || cluster.restarts.current < cluster.restarts.max) return;
      stopClusters(manager);
      onExhausted(cluster.id);
    });
  });
}

async function start() {
  const config = loadConfig();
  if (!config) {
    console.error("Set DISCORD_TOKEN and MONGODB_URI, or fill in the corresponding settings.js values.");
    process.exitCode = 1;
    return;
  }

  const totalShards = await discoverShardCount(config.token);
  const manager = new ClusterManager(join(__dirname, "bot.js"), {
    token: config.token,
    totalShards,
    shardsPerClusters: 10,
    totalClusters: "auto",
    mode: "process",
  });

  manager.extend(new ReClusterManager());
  monitorClusters(manager, (clusterId) => {
    console.error(`Cluster #${clusterId} exhausted its restart limit. Stopping the bot.`);
    process.exitCode = 1;
  });
  try {
    await manager.spawn({ timeout: 60_000 });
  } catch (error) {
    stopClusters(manager);
    throw error;
  }
}

if (require.main === module) {
  start().catch((error) => {
    logError("Bot startup", error);
    process.exitCode = 1;
  });
}

module.exports = { discoverShardCount, monitorClusters };
