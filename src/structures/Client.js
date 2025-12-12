const {
  ActivityType,
  Client,
  Collection,
  GatewayIntentBits,
  Message,
  Sweepers,
} = require("discord.js");
const { ClusterClient } = require("discord-hybrid-sharding");
const mongoose = require("mongoose");
const { readdirSync } = require("fs");
const settings = require("../../settings");
const Util = require("./Util");
const checkGiveawayEnd = require("../events/checkGiveawayEnd");

class GiveawayBot extends Client {
  /**
   * @type ClusterClient
   */
  cluster;
  constructor() {
    super({
      allowedMentions: {
        parse: ["users", "roles", "everyone"],
        repliedUser: false,
      },
      intents: [GatewayIntentBits.Guilds],
      presence: {
        activities: [
          {
            name: `🎉 Hosting Giveaways`,
            type: ActivityType.Custom,
          },
        ],
      },

      shards: ClusterClient.getInfo().SHARD_LIST,
      shardCount: ClusterClient.getInfo().TOTAL_SHARDS,
    });

    this.cluster = new ClusterClient(this);
    this.events = new Collection();
    this.commands = new Collection();
    this.settings = settings;
    this.owners = this.settings.dev;
    this.util = new Util(this);
  }

  setupCustomSweepers() {
    setInterval(() => {
      const amount = this.sweepers.sweepMessages(
        Sweepers.filterByLifetime({
          lifetime: 1800,
          getComparisonTimestamp: (m) =>
            m.editedTimestamp ?? m.createdTimestamp,
        })()
      );
    }, 3600000);

    setInterval(() => {
      const amount = this.sweepers.sweepGuildMembers(
        Sweepers.filterByLifetime({
          lifetime: 2100,
          getComparisonTimestamp: (m) => m.joinedTimestamp,
          excludeFromSweep: (m) => m.id === this.user.id,
        })()
      );
    }, 3600000);

    setInterval(() => {
      const amount = this.sweepers.sweepInvites(
        Sweepers.filterByLifetime({
          lifetime: 1800,
          getComparisonTimestamp: (invite) => invite.createdTimestamp,
        })()
      );
    }, 3600000);
  }

  build() {
    let commandsCount = 0;
    readdirSync("./src/commands").forEach((category) => {
      readdirSync(`./src/commands/${category}`).forEach((command) => {
        commandsCount++;
        this.commands.set(command.split(".")[0], {
          ...require(`../commands/${category}/${command}`),
          category,
        });
      });
    });
    let eventsCount = 0;
    readdirSync("./src/events").forEach((event) => {
      eventsCount++;
      this.events.set(event.split(".")[0], require(`../events/${event}`));
      this[`on${event === "ready.js" ? "ce" : ""}`](
        event.split(".")[0],
        (...args) => this.events.get(event.split(".")[0])(this, ...args)
      );
    });

    this.login(this.settings.TOKEN);
    mongoose.connect(this.settings.MongoDB, {
      useUnifiedTopology: true,
      useNewUrlParser: true,
      maxPoolSize: 6,
      minPoolSize: 1,
      connectTimeoutMS: 10000,
      retryWrites: true,
    });
    if (this.cluster.id === 0) {
      console.log(`➜     Loaded ${commandsCount} commands.`);
      console.log(`➜     Loaded ${eventsCount} events.`);
    }
    this.once("ready", async (client) => {
      checkGiveawayEnd(client);
      this.setupCustomSweepers();
    });
    return this;
  }

  /**
   * @param {string} channelId
   * @param {import("discord.js").MessageCreateOptions} options
   */
  async createMessage(channelId, options) {
    return new Message(
      this,
      await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${this.settings.TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(options),
        }
      ).then((response) => response.json())
    );
  }

  /**
   * @param {string} channelId
   * @param {string} messageId
   */
  async deleteMessage(channelId, messageId) {
    await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bot ${this.settings.TOKEN}`,
        },
      }
    );
  }

  /**
   * @param {string} channelId
   * @param {string} messageId
   * @param {import("discord.js").MessageEditOptions} options
   */
  async editMessage(channelId, messageId, options) {
    return new Message(
      this,
      await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bot ${this.settings.TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(options),
        }
      ).then((response) => response.json())
    );
  }
}

module.exports = GiveawayBot;
