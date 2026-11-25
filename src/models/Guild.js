const { Schema, Types, model } = require("mongoose");
const { PermissionFlagsBits } = require("discord.js");

const DEFAULT_COLOR = "#0000FF";
const DEFAULT_EMOJI = "🎉";
const CUSTOM_EMOJI = /^<a?:[A-Za-z0-9_]{2,32}:(\d{17,20})>$/;
const UNICODE_EMOJI = /^\p{RGI_Emoji}$/v;
const missingAppEmojis = new WeakMap();

function normalizeColor(input) {
  if (typeof input !== "string") return null;
  const color = input.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return "#" + [...color.slice(1).toUpperCase()].map((digit) => digit.repeat(2)).join("");
  }
  return null;
}

function normalizeEmoji(input, guild) {
  if (typeof input !== "string") return null;
  const emoji = input.trim();
  if (!emoji) return null;
  if (UNICODE_EMOJI.test(emoji)) return emoji;
  if ([...emoji].length === 1 && UNICODE_EMOJI.test(emoji + "\uFE0F")) return emoji + "\uFE0F";

  const custom = CUSTOM_EMOJI.exec(emoji);
  if (!custom) return null;
  if (!guild) return emoji;

  const available = guild.emojis?.cache.get(custom[1]);
  return canUseGuildEmoji(available) ? available.toString() : null;
}

function canUseGuildEmoji(emoji) {
  if (!emoji || emoji.available === false) return false;
  const roles = emoji.roles?.cache;
  return !roles?.size || roles.some((role) => emoji.guild?.members.me?.roles.cache.has(role.id));
}

async function resolveEmoji(input, guild, channel) {
  const normalized = normalizeEmoji(input, guild);
  if (normalized || typeof input !== "string" || !guild?.client) return normalized;
  const match = CUSTOM_EMOJI.exec(input.trim());
  if (!match) return null;
  const id = match[1];
  const { client } = guild;

  const external = client.emojis?.cache.get(id);
  const permissions = channel?.permissionsFor?.(client.user) ?? guild.members?.me?.permissions;
  if (canUseGuildEmoji(external) && permissions?.has(PermissionFlagsBits.UseExternalEmojis)) {
    return external.toString();
  }

  const app = client.application?.emojis;
  if (!app) return null;
  const known = app.cache.get(id);
  if (known) return known.toString();
  let misses = missingAppEmojis.get(app);
  if (!misses) {
    misses = new Map();
    missingAppEmojis.set(app, misses);
  }
  if (misses.get(id) > Date.now()) return null;
  try {
    return (await app.fetch(id)).toString();
  } catch {
    if (misses.size >= 256) misses.delete(misses.keys().next().value);
    misses.set(id, Date.now() + 60_000);
    return null;
  }
}

const schema = new Schema({
  id: { type: String, required: true },
  embedColor: { type: String, default: DEFAULT_COLOR },
  giveawayEmoji: { type: String, default: DEFAULT_EMOJI },
});
schema.index({ id: 1, _id: 1 });

schema.statics.getSettings = async function (id, guild, channel) {
  const saved = await this.findOne({ id }).sort({ _id: 1 }).lean();
  return {
    id,
    embedColor: normalizeColor(saved?.embedColor) ?? DEFAULT_COLOR,
    giveawayEmoji: await resolveEmoji(saved?.giveawayEmoji, guild, channel) ?? DEFAULT_EMOJI,
  };
};

schema.statics.updateSettings = async function (id, update) {
  const existing = await this.findOne({ id }, { _id: 1 }).sort({ _id: 1 }).lean();
  if (existing) {
    return this.updateOne({ _id: existing._id }, { $set: update }, { runValidators: true });
  }

  // Reserve one ObjectId per guild so concurrent first writes share one record.
  // Legacy guilds keep their existing document, even if older versions made duplicates.
  const _id = new Types.ObjectId(BigInt(id).toString(16).padStart(24, "0"));
  const filter = { _id };
  try {
    return await this.updateOne(filter, { $set: update, $setOnInsert: { id } }, {
      upsert: true,
      runValidators: true,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return this.updateOne(filter, { $set: update }, { runValidators: true });
  }
};

const Guild = model("Guild", schema);
Guild.normalizeColor = normalizeColor;
Guild.normalizeEmoji = normalizeEmoji;
Guild.resolveEmoji = resolveEmoji;
module.exports = Guild;
