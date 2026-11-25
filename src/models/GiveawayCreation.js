const { Schema, model } = require("mongoose");

const schema = new Schema({
  _id: String,
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  hostId: { type: String, required: true },
  prize: { type: String, required: true },
  description: String,
  seconds: { type: Number, required: true },
  winnersCount: { type: Number, required: true },
  color: { type: String, required: true },
  emoji: { type: String, required: true },
  state: { type: String, enum: ["queued", "done", "failed"], required: true },
  messageId: String,
  sendStartedAt: Date,
  searchBefore: String,
  lease: String,
  retryAt: Date,
  expiresAt: Date,
});

schema.index({ guildId: 1, state: 1, retryAt: 1 });
schema.index({ guildId: 1, channelId: 1, messageId: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model("GiveawayCreation", schema);
