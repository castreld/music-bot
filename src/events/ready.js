'use strict';

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`[Ready] Logged in as ${client.user.tag}`);
    client.user.setActivity('/play', { type: 2 }); // type 2 = Listening
  },
};
