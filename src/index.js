'use strict';

// Only load .env locally — Railway/production sets env vars directly
if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const { Client, Collection, GatewayIntentBits } = require('discord.js');
const YouTube = require('./core/YoutubeWrapper');
const Gemini  = require('./core/GeminiRecommender');

// Initialize services before starting the bot
Gemini.init();
YouTube.init().then(() => startBot()).catch(console.error);

function startBot() {
const fs   = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Load commands into a Collection
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  client.commands.set(cmd.data.name, cmd);
}

// Load event handlers
const eventsDir = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  const method = event.once ? 'once' : 'on';
  client[method](event.name, (...args) => event.execute(...args, client));
}

  client.login(process.env.DISCORD_TOKEN);
}
