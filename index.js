const fs = require('fs');
const Discord = require('discord.js');
// TODO(aalberg): Use JSON.parse and maybe some more complex handling here.
const {token} = require('./config_private.json');
const config = require('./config.json');

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

const increment = (map, key) => {
  if (map.has(key)) {
    map.set(key, map.get(key) + 1);
  } else {
    map.set(key, 1);
  }
};

const getDayReactions = (map, message) => {
  for (const reaction of message.reactions.values()) {
    switch (reaction.emoji.name) {
      case '🇲':
        increment(map, '🇲');
        break;
      case '🇹':
        increment(map, '🇹');
        break;
      case '🇼':
        increment(map, '🇼');
        break;
      case '🇷':
        increment(map, '🇷');
        break;
      case '🇫':
        increment(map, '🇫');
        break;
      case '🇸':
        increment(map, '🇸');
        break;
      case '🇺':
        increment(map, '🇺');
        break;
    }
  }
};

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
const maxDayCounts = new Map();
for (const emojiName of validDays.keys()) {
  maxDayCounts.set(emojiName, 0);
}

// A pretty useful method to create a delay without blocking the whole script.
const wait = require('util').promisify(setTimeout);

// ================ Once on Startup ================

client.once('ready', () => {
  // "ready" isn't really ready. We need to wait a spell.
  // NOTE(teejusb): Not sure if this is necessary, but it was recommended here:
  // https://github.com/AnIdiotsGuide/discordjs-bot-guide/blob/master/coding-guides/tracking-used-invites.md
  // It's probably used to wait while the fetchInvites promise completes.
  wait(1000);

  // Get all the invites from the Zerowatch discord.
  const guild = client.guilds.get(config.guildId);

  if (guild) {
    guild.fetchInvites()
        .then((guildInvites) => {
          console.log(`There are currently ${guildInvites.size} invites.`);
          for (const [code, invite] of guildInvites) {
            console.log(
                `  Available invite code ${code} with ${invite.uses} uses`);
            // Only need to keep track of guest invite usages.
            if (code === config.guestCode) {
              guestUses = invite.uses;
            }
          }
        });
  }

  const pugPollChannel = client.channels.get(config.pugPollChannelId);
  if (pugPollChannel) {
    if (pugPollChannel.lastMessageID) {
      // The last message posted is the current poll.
      pugPollChannel.fetchMessage(pugPollChannel.lastMessageID)
          .then((message) => {
            curPugMessage = message;
            getDayReactions(maxDayCounts, message);
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

  // We only care for reactions to the PUG poll.
  if (messageReaction.message.id !== curPugMessage.id) return;

  const emojiName = messageReaction.emoji.name;

  // If people reacted to to the PUG poll with a non-valid reaction,
  // just remove it.
  if (!validDays.has(emojiName)) {
    messageReaction.remove(user);
    return;
  }
  // We use maxDayCounts to ensure we only send each of the following
  // messages once for each of the days. Members can technically add/remove
  // reactions as they wish so we try and do something about that.
  // TODO(teejusb): If a user removes a reaction after we already said that
  // PUGs are on, we should handle that. Figure out a clean way to do this
  // that also minimizes spam.
  // TODO(teejusb): It would be cool if we only sent these messages on the day
  // they were meant for, but that requires us to keep track of what day it is
  // and when it changes.
  const curCount = maxDayCounts.get(emojiName);
  if (messageReaction.count > curCount) {
    maxDayCounts.set(emojiName, messageReaction.count);

    const pugAnnounce = client.channels.get(config.pugAnnounceChannelId);

    if (messageReaction.count === 12) {
      pugAnnounce.send(`PUGs are on for ${validDays.get(emojiName)}!`);
    }
  }
});

// ================ On guildMemberAdd ================
// Handler for when new members join the server.

client.on('guildMemberAdd', (member) => {
  member.guild.fetchInvites().then((guildInvites) => {
    const invite = guildInvites.get(config.guestCode);
    if (invite) {
      if (invite.uses == guestUses) {
        const role = member.guild.roles.find((r) => r.name === 'Member');
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
  if (message.channel.id === config.pugPollChannelId) {
    // Only the poll should be posted in this channel.
    // If a new poll was posted then reset the PUG poll variables.
    curPugMessage = message;
    for (const emojiName of valid_days.keys()) {
      maxDayCounts.set(emojiName, 0);
    }
    console.log('New PUG poll was posted.');
    return;
  }

  // Only respond to messages sent from real users and those that are
  // config.prefixed appropriatly.
  if (!message.content.startsWith(config.prefix) ||
      message.author.bot) return;

  // Temporary, limit commands to a single channel.
  if (message.channel.name !== config.testChannel) return;

  // Regex soup from: https://stackoverflow.com/a/25663729
  const args = message.content.slice(config.prefix.length).trim()
      .split(/ +(?=(?:(?:[^"]*"){2})*[^"]*$)/g);
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
      reply += `\`${config.prefix}${command.name} ${command.usage}\``;
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

client.login(token);
