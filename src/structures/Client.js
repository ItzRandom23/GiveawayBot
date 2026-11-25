const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { ActivityType, Client, Collection, Events, GatewayIntentBits, Options, Partials } = require("discord.js");
const { ClusterClient, getInfo } = require("discord-hybrid-sharding");
const mongoose = require("mongoose");
const Util = require("./Util");
const { logError } = require("./config");
const checkGiveawayEnd = require("../events/checkGiveawayEnd");
const handleInteraction = require("../events/interactionCreate");
const registerCommands = require("../events/ready");
const { startCreationRecovery } = require("./GiveawayCreation");
const { removeDeletedGiveaways } = require("./GiveawayLifecycle");
const { startMessageReconciliation, removeDeletedChannel } = require("./GiveawayReconciliation");
const GiveawayCreation = require("../models/GiveawayCreation");
const GiveawayData = require("../models/GiveawayData");
const Guild = require("../models/Guild");

class GiveawayBot extends Client {
  constructor(config) {
    const { SHARD_LIST, TOTAL_SHARDS } = getInfo();
    super({
      allowedMentions: { parse: [], repliedUser: false },
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildExpressions],
      partials: [Partials.Message],
      makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0 }),
      presence: { activities: [{ name: "🎉 Hosting Giveaways", type: ActivityType.Custom }] },
      shards: SHARD_LIST,
      shardCount: TOTAL_SHARDS,
    });

    this.cluster = new ClusterClient(this);
    this.commands = new Collection();
    this.config = config;
    this.owners = config.owners;
    this.util = new Util(this);
    this.commandRegistration = new AbortController();
  }

  loadCommands() {
    const commandsDir = join(__dirname, "..", "commands");
    for (const category of readdirSync(commandsDir, { withFileTypes: true })) {
      if (!category.isDirectory()) continue;
      const directory = join(commandsDir, category.name);
      for (const file of readdirSync(directory, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(".js")) continue;
        const command = require(join(directory, file.name));
        if (this.commands.has(command.name)) throw new Error("Duplicate command " + command.name);
        this.commands.set(command.name, { ...command, category: category.name });
      }
    }
  }

  async build() {
    this.loadCommands();
    this.on(Events.Error, (error) => logError("Discord client", error));
    this.on(Events.ShardError, (error) => logError("Discord shard", error));
    this.on(Events.InteractionCreate, async (interaction) => {
      try {
        await handleInteraction(this, interaction);
      } catch (error) {
        logError("Interaction handler", error);
      }
    });
    const removeGiveaways = (guildId, channelId, messageIds) => {
      if (!guildId) return;
      removeDeletedGiveaways(guildId, channelId, messageIds)
        .catch((error) => logError("Deleted giveaway cleanup", error));
    };
    this.on(Events.MessageDelete, (message) => {
      removeGiveaways(message.guildId, message.channelId, [message.id]);
    });
    this.on(Events.MessageBulkDelete, (messages, channel) => {
      removeGiveaways(channel.guildId, channel.id, [...messages.keys()]);
    });
    const removeChannelGiveaways = (channel) => {
      if (!channel.guildId) return;
      removeDeletedChannel(channel.guildId, channel.id)
        .catch((error) => logError("Deleted channel cleanup", error));
    };
    this.on(Events.ChannelDelete, removeChannelGiveaways);
    this.on(Events.ThreadDelete, removeChannelGiveaways);
    this.once(Events.ClientReady, async () => {
      try {
        this.cluster.triggerReady();
        console.log("Cluster #" + this.cluster.id + " is online with " + this.commands.size + " commands.");
        this.stopGiveawayScheduler = checkGiveawayEnd(this);
        this.stopCreationRecovery = startCreationRecovery(this);
        this.stopMessageReconciliation = startMessageReconciliation(this);
        await registerCommands(this, { signal: this.commandRegistration.signal });
      } catch (error) {
        logError("Discord ready handler", error);
      }
    });

    mongoose.connection.on("error", (error) => logError("MongoDB connection", error));
    await mongoose.connect(this.config.mongoUri, {
      bufferCommands: false,
      maxPoolSize: 6,
      serverSelectionTimeoutMS: 10_000,
      waitQueueTimeoutMS: 10_000,
      socketTimeoutMS: 30_000,
    });
    await Promise.all([GiveawayCreation.init(), GiveawayData.init(), Guild.init()]);
    await this.login(this.config.token);
    return this;
  }

  async destroy() {
    this.commandRegistration.abort();
    this.stopGiveawayScheduler?.();
    this.stopCreationRecovery?.();
    this.stopMessageReconciliation?.();
    try {
      await super.destroy();
    } finally {
      await mongoose.disconnect();
    }
  }
}

module.exports = GiveawayBot;
