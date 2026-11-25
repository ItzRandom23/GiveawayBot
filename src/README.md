# GiveawayBot

From the repository root, use a supported Node.js LTS release and install the dependencies locked in this directory.

```sh
npm ci --prefix src
npm start --prefix src
```

Set `DISCORD_TOKEN` and `MONGODB_URI` in the process environment before starting the bot. The bot also accepts the existing `settings.js` configuration. `DISCORD_OWNER_IDS` is optional and accepts a comma-separated list of Discord user IDs.

Use MongoDB 6 or newer. Quote Discord IDs in `settings.js` to preserve every digit.

The giveaway post displays the saved result. Winner pings are best-effort. If Discord's response is ambiguous, the bot keeps the result and avoids another ping.
