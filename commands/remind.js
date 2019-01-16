// For Discord.Collections
const Discord = require('discord.js');

module.exports = {
  name: 'remind',
  cooldown: 15 * 60, // 15 minutes
  description: 'Remind the missing players for today\'s PUGs',
  async execute(message, args) {
    let pugPollChannel;
    const pugVoiceChannels = [];

    message.client.channels.forEach((channel) => {
      if (channel.name === 'pug-poll') {
        pugPollChannel = channel;
      } else if (channel.name === 'PUG Lobby' ||
                 channel.name === 'PUG Blue' ||
                 channel.name === 'PUG Red') {
        pugVoiceChannels.push(channel);
      }
    });

    if (pugPollChannel && pugVoiceChannels.length === 3) {
      const curPugMessage = await pugPollChannel.fetchMessage(
          pugPollChannel.lastMessageID);
      const curDate = new Date();
      // curDate.getDay() is 0-indexed where 0 = Sunday.
      const days = ['🇺', '🇲', '🇹', '🇼', '🇷', '🇫', '🇸'];
      let toRemindUsers = new Discord.Collection();
      for (const reaction of curPugMessage.reactions.values()) {
        if (reaction.emoji.name === days[curDate.getDay()]) {
          toRemindUsers = await reaction.fetchUsers();
        }
      }
      console.log(`${toRemindUsers.size} users found from poll`);

      for (const voiceChannel of pugVoiceChannels) {
        for (const id of voiceChannel.members.keys()) {
          if (toRemindUsers.has(id)) {
            toRemindUsers.delete(id);
          }
        }
      }

      if (toRemindUsers.size > 0) {
        messageText = '';
        for (const user of toRemindUsers.values()) {
          if (messageText.length > 0) messageText += ', ';
          messageText += user.toString();
        }
        messageText += ', we\'re waiting for you for PUGs! :D';

        message.channel.send(messageText);
      }
    } else {
      message.channel.send('Hmmm. Something went wrong...');
    }
  },
};
