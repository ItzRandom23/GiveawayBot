const { Schema, model } = require("mongoose");

const pendingOperation = new Schema({
  token: String,
  kind: { type: String, enum: ["end", "delete", "reroll"] },
  count: Number,
  winnerIds: { type: [String], default: undefined },
  retryAt: Date,
  attemptId: String,
  failures: { type: Number, default: 0 },
  sourceFailureCode: Number,
  separateAnnouncement: Boolean,
}, { _id: false });

const queuedAnnouncement = new Schema({
  token: String,
  kind: String,
  winnerIds: [String],
}, { _id: false });

const giveawaySchema = new Schema({
  id: String,
  channelId: String,
  description: String,
  messageId: { type: String, unique: true },
  prize: String,
  hostId: String,
  winnersCount: Number,
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  participants: { type: [String], default: [] },
  isActive: { type: Boolean, default: true },
  entryCount: { type: Number, default: 0 },
  pending: pendingOperation,
  winnerHistory: { type: [String], default: undefined },
  queuedAnnouncements: { type: [queuedAnnouncement], default: undefined },
  nextMessageCheckAt: Date,
});

giveawaySchema.index({ id: 1, isActive: 1, endTime: 1 });
giveawaySchema.index({ id: 1, "pending.retryAt": 1 }, {
  partialFilterExpression: { "pending.retryAt": { $exists: true } },
});
giveawaySchema.index({ id: 1, "queuedAnnouncements.0": 1 }, {
  partialFilterExpression: { "queuedAnnouncements.0": { $exists: true } },
});
giveawaySchema.index({ id: 1, isActive: 1, nextMessageCheckAt: 1 });

module.exports = model("GiveawayData", giveawaySchema);
