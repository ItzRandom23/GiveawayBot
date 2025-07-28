<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=200&section=header&text=GiveawayBot&fontSize=80&fontAlignY=35&animation=twinkling&fontColor=gradient" alt="GiveawayBot Banner"/>
</p>

# GiveawayBot

A modern, easy-to-use Discord bot for hosting and managing giveaways, inspired by the original GiveawayBot#2381. Built with [discord.js](https://discord.js.org/) and [mongoose](https://mongoosejs.com/).

---

## Features

- 🎉 Start, end, reroll, and delete giveaways with simple commands
- 🏆 Interactive giveaway creation with modals
- 🖌️ Customizable embed color and emoji
- 📋 List all active giveaways with pagination
- ⚡ Fast, scalable, and sharding-ready
- 🛡️ Permission checks and robust error handling

---

## Installation

### 1. Clone the repository

```sh
git clone https://github.com/ItzRandom23/GiveawayBot.git
cd GiveawayBot
```

### 2. Install dependencies

```sh
npm install
```

### 3. Configure your settings

Edit [`settings.js`](settings.js) and fill in your bot token, MongoDB connection string, and owner ID:

```js
module.exports = {
  TOKEN: "your-bot-token-here",
  MongoDB: "your-mongodb-connection-string-here",
  dev: "your-discord-user-id-here",
};
```

### 4. Start the bot

```sh
npm start
```

---

## Usage

Invite your bot to your server using the OAuth2 link (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?permissions=347200&scope=bot+applications.commands&client_id=YOUR_CLIENT_ID
```

Use `/help` in your server to see all available commands.

---

## Commands

- `/start` — Start a giveaway
- `/create` — Interactive giveaway creation
- `/end` — End an active giveaway
- `/delete` — Delete a giveaway
- `/reroll` — Reroll winners
- `/list` — List active giveaways
- `/settings` — Show current settings
- `/setcolor` — Set embed color
- `/setemoji` — Set giveaway emoji
- `/about`, `/ping`, `/invite`, `/help` — Info & utility

---

## Support & Contributing

- [Source Code](https://github.com/ItzRandom23/GiveawayBot)
- [Support Server](https://discord.gg/6jP4G5kdUc)

Feel free to open issues or pull requests!

---

## License

This project is licensed under