'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { REST, Routes } = require('discord.js');
const path = require('path');
const fs   = require('fs');

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId  = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('ERROR: DISCORD_TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

const commandsDir = path.join(__dirname, '../src/commands');
const commands = fs
  .readdirSync(commandsDir)
  .filter(f => f.endsWith('.js'))
  .map(f => require(path.join(commandsDir, f)).data.toJSON());

const rest  = new REST().setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash commands ${guildId ? `to guild ${guildId}` : 'globally'}…`);
    await rest.put(route, { body: commands });
    console.log('Done!');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
