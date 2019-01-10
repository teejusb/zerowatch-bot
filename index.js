const fs = require('fs');
const cron = require('cron');
const Discord = require('discord.js');

// TODO(teejusb): This is going to get unruly real quick. We might just want
// to load this as 'config' and access the members individually, or find a
// nicer way to specify many members.
const {prefix, token, guildId, guestCode, testChannel,
  pugPollChannelId, pugAnnounceChannelId} =
      require('./config.json');

const client = new Discord.Client();
client.commands = new Discord.Collection();

// Read all available commands from disk.
const commandFiles = fs.readdirSync('./commands')
    .filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.name, command);
}

// Setup collection to manage per-command cooldowns.
const cooldowns = new Discord.Collection();

// Keep track of existing guest invite usages.
// This is used to let the bot automatically assign roles if necessary.
let guestUses = 0;

const validDays = new Map();
validDays.set('🇲', 'Monday');
validDays.set('🇹', 'Tuesday');
validDays.set('🇼', 'Wednesday');
validDays.set('🇷', 'Thursday');
validDays.set('🇫', 'Friday');
validDays.set('🇸', 'Saturday');
validDays.set('🇺', 'Sunday');

// Keep track of current PUG poll information.
let curPugMessage;

// A pretty useful method to create a delay without blocking the whole script.
const wait = require('util').promisify(setTimeout);

// Start a cron job that executes a function every hour on the hour.
// NOTE(teejusb): Currently an hour poller is excessive, but it's to handle
// future features.
const hourPoller = cron.job('0 0 * * * *', function() {
  const curDate = new Date();
  // If it's Monday at 12 PM PST, post a new PUG poll.
  if (curDate.getHours() === 12) {
    if (curDate.getDay() === 1) {
      const oneWeekFromNow = new Date();
      oneWeekFromNow.setDate(curDate().getDate() + 7);

      let pugPollText = '**PUG Availability Poll for ';
      if (curDate.getMonth() == oneWeekFromNow.getMonth()) {
        // E.g. Jan 7-13
        pugPollText +=
            `${curDate.toLocaleString('en-us', {month: 'short'})} ` +
            `${curDate.getDate()}-${oneWeekFromNow.getDate()}`;
      } else {
        // E.g. Jan 31-Feb 6
        pugPollText +=
            `${curDate.toLocaleString('en-us', {month: 'short'})} ` +
            `${curDate.getDate()}-` +
            `${oneWeekFromNow.toLocaleString('en-us', {month: 'short'})} ` +
            `${oneWeekFromNow.getDate()}**\n`;
      }

      pugPollText +=
          'Please vote with your availibility with the following reactions ' +
          '(generally 8PM PST):\n' +
          '\n'+
          '🇲 - Monday\n' +
          '🇹 - Tuesday\n' +
          '🇼 - Wednesday\n' +
          '🇷 - Thursday\n' +
          '🇫 - Friday\n' +
          '🇸 - Saturday\n' +
          '🇺 - Sunday\n';

      const pugPollChannel = client.channels.get(pugPollChannelId);
      pugPollChannel.send(pugPollText);
    }
  }
});
hourPoller.start();

// ================ Once on Startup ================

client.once('ready', () => {
  // "ready" isn't really ready. We need to wait a spell.
  // NOTE(teejusb): Not sure if this is necessary, but it was recommended here:
  // https://github.com/AnIdiotsGuide/discordjs-bot-guide/blob/master/coding-guides/tracking-used-invites.md
  // It's probably used to wait while the fetchInvites promise completes.
  wait(1000);

  // Get all the invites from the Zerowatch discord.
  const guild = client.guilds.get(guildId);
  if (guild) {
    guild.fetchInvites()
        .then((guildInvites) => {
          console.log(`There are currently ${guildInvites.size} invites.`);
          for (const [code, invite] of guildInvites) {
            console.log(
                `  Available invite code ${code} with ${invite.uses} uses`);
            // Only need to keep track of guest invite usages.
            if (code === guestCode) {
              guestUses = invite.uses;
            }
          }
        });
  }

  const pugPollChannel = client.channels.get(pugPollChannelId);
  if (pugPollChannel) {
    if (pugPollChannel.lastMessageID) {
      // The last message posted is the current poll.
      pugPollChannel.fetchMessage(pugPollChannel.lastMessageID)
          .then((message) => {
            curPugMessage = message;
            console.log('Found PUG message!');
          });
    }
  }

  console.log('Ready!');
});

// ================ On messageReactionAdd ================
// Handler for when members react to the PUG poll.

client.on('messageReactionAdd', (messageReaction, user) => {
  // If we can't find the current PUG poll for whatever reason, return early.
  if (typeof curPugMessage === 'undefined' || curPugMessage === null) return;

  // We only care for reactions to the current PUG poll.
  if (messageReaction.message.id !== curPugMessage.id) return;

  const emojiName = messageReaction.emoji.name;

  // If people reacted to to the PUG poll with a non-valid reaction,
  // just remove it.
  if (!validDays.has(emojiName)) {
    messageReaction.remove(user);
    return;
  }

  // If we hit 12, then that means we incremented from 11.
  // TODO(teejusb): It would be cool if we only sent these messages on the day
  // they were meant for, but that requires us to keep track of what day it is
  // and when it changes.
  if (messageReaction.count === 12) {
    const pugAnnounce = client.channels.get(pugAnnounceChannelId);
    pugAnnounce.send(`PUGs are on for ${validDays.get(emojiName)}!`);
  }
});

// ================ On messageReactionRemove ================
// Handler for when members remove reactions to the PUG poll.

client.on('messageReactionRemove', (messageReaction, user) => {
  // If we can't find the current PUG poll for whatever reason, return early.
  if (typeof curPugMessage === 'undefined' || curPugMessage === null) return;

  // We only care for reactions to the current PUG poll.
  if (messageReaction.message.id !== curPugMessage.id) return;

  // If a bot removed the reaction, we can return early.
  if (user.bot) return;

  const emojiName = messageReaction.emoji.name;

  // If we dropped below the threshold then notify users that we've lost quorum
  // for that day. If we hit 11, then that means we decremented from 12.
  if (messageReaction.count === 11) {
    const pugAnnounce = client.channels.get(pugAnnounceChannelId);
    pugAnnounce.send(
        `We no longer have enough for PUGs on ${validDays.get(emojiName)} :(`);
  }
});


// ================ On guildMemberAdd ================
// Handler for when new members join the server.

client.on('guildMemberAdd', (member) => {
  member.guild.fetchInvites().then((guildInvites) => {
    const invite = guildInvites.get(guestCode);
    if (invite) {
      if (invite.uses == guestUses) {
        const role = member.guild.roles.find((r) => r.name === 'TempRole');
        member.addRole(role, 'Auto-added via bot.');
      } else {
        guestUses = invite.uses;
      }
    }
  });
});

// ================ On message ================
// Handler for responding to messages (a la slackbot).

client.on('message', (message) => {
  if (message.channel.id === pugPollChannelId) {
    // Only the poll should be posted in this channel.
    // If a new poll was posted then reset the PUG poll variables.
    curPugMessage = message;
    console.log('New PUG poll was posted.');
    return;
  }

  // Only respond to messages sent from real users and those that are
  // prefixed appropriatly.
  if (!message.content.startsWith(prefix) ||
      message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName) ||
                  client.commands.find(
                      (cmd) => cmd.aliases &&
                          cmd.aliases.includes(commandName));

  if (!command) return;

  // Sanity check for commands that require arguments.
  if (command.args && !args.length) {
    let reply = `You didnt provide any arguments, ${message.author}!`;

    if (command.usage) {
      reply += '\nThe proper usage would be: ';
      reply += `\`${prefix}${command.name} ${command.usage}\``;
    }
    return message.channel.send(reply);
  }

  // Check command cooldowns to reduce any possible spam.
  if (!cooldowns.has(command.name)) {
    cooldowns.set(command.name, new Discord.Collection());
  }

  const now = Date.now();
  const timestamps = cooldowns.get(command.name);
  const cooldownAmount = (command.cooldown || 3) * 1000;

  if (timestamps.has(message.author.id)) {
    const expirationTime = timestamps.get(message.author.id) + cooldownAmount;

    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000;
      return message.reply(`please wait ${timeLeft.toFixed(1)} more second(s) `
                         + `before reusing the \`${command.name}\` command.`);
    }
  }

  timestamps.set(message.author.id, now);
  setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

  // Execute the command.
  try {
    command.execute(message, args);
  } catch (error) {
    console.error(error);
    message.reply('there was an error trying to execute that command!');
  }
});

client.on('error', (e) => console.error(e));
client.on('warn', (e) => console.warn(e));
client.on('debug', (e) => console.info(e));

client.login(token);
