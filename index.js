const fs = require('fs');
const Discord = require('discord.js');
const {prefix, token, guildId, guestCode,
       pugPollChannelId, pugAnnounceChannelId} = require('./config.json');

const client = new Discord.Client();
client.commands = new Discord.Collection();

// Read all available commands from disk.
const commandFiles = fs.readdirSync('./commands')
                       .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.name, command);
}

// Setup collection to manage per-command cooldowns.
const cooldowns = new Discord.Collection();

// Keep track of existing guest invite usages.
// This is used to let the bot automatically assign roles if necessary.
let guest_uses = 0;

let increment = (map, key) => {
  if (map.has(key)) {
    map.set(key, map.get(key) + 1);
  } else {
    map.set(key, 1);
  }
}

let getDayReactions = (map, message) => {
  for (let [reaction_id, reaction] of message.reactions) {
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
}

let valid_days = new Map();
valid_days.set('🇲', 'Monday');
valid_days.set('🇹', 'Tuesday');
valid_days.set('🇼', 'Wednesday');
valid_days.set('🇷', 'Thursday');
valid_days.set('🇫', 'Friday');
valid_days.set('🇸', 'Saturday');
valid_days.set('🇺', 'Sunday');

// Keep track of current PUG poll information.
let cur_pug_message;
let max_day_counts = new Map();
for (let [emoji_name, day] of valid_days) {
  max_day_counts.set(emoji_name, 0);
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
  let guild = client.guilds.get(guildId);

  if (guild) {
    guild.fetchInvites()
        .then(guildInvites => {
          console.log(`There are currently ${guildInvites.size} invites.`);
          for (let [code, invite] of guildInvites) {
            console.log(`  Available invite code ${code} with ${invite.uses} uses`);
            // Only need to keep track of guest invite usages.
            if (code === guestCode) {
              guest_uses = invite.uses;
            }
          }
        });
  }

  let pug_poll_channel = client.channels.get(pugPollChannelId);
  if (pug_poll_channel) {
    // The last message posted is the current poll.
    pug_poll_channel.fetchMessage(pug_poll_channel.lastMessageID)
        .then(message => {
          cur_pug_message = message;
          getDayReactions(max_day_counts, message);
          console.log('Found PUG message!');
        });
  }


  console.log('Ready!');
});

// ================ On messageReactionAdd ================
// Handler for when members react to the PUG poll.

client.on('messageReactionAdd', (messageReaction, user) => {
  // If we can't find the current PUG poll for whatever reason, return early.
  if (typeof cur_pug_message === 'undefined' || cur_pug_message === null) return;

  // We only care for reactions to the PUG poll.
  if (messageReaction.message.id !== cur_pug_message.id) return;

  let emoji_name = messageReaction.emoji.name;

  // If people reacted to to the PUG poll with a non-valid reaction,
  // just remove it.
  if (!valid_days.has(emoji_name)) {
    messageReaction.remove(user);
    return;
  }
  // We use max_day_counts to ensure we only send each of the following
  // messages once for each of the days. Members can technically add/remove
  // reactions as they wish so we try and do something about that.
  // TODO(teejusb): If a user removes a reaction after we already said that
  // PUGs are on, we should handle that. Figure out a clean way to do this
  // that also minimizes spam.
  // TODO(teejusb): It would be cool if we only sent these messages on the day
  // they were meant for, but that requires us to keep track of what day it is
  // and when it changes.
  let cur_count = max_day_counts.get(emoji_name);
  if (messageReaction.count > cur_count) {
    max_day_counts.set(emoji_name, messageReaction.count);

    let pug_announce = client.channels.get(pugAnnounceChannelId);
    
    if (messageReaction.count === 12) {
      pug_announce.send(`PUGs are on for ${valid_days.get(emoji_name)}!`);
    }
  }
});

// ================ On guildMemberAdd ================
// Handler for when new members join the server.

client.on('guildMemberAdd', member => {
  member.guild.fetchInvites().then(guildInvites => {
    for (let [code, invite] of guildInvites) {
      if (code === guestCode) {
        // If guest code did not increment, then this was a custom invite.
        // Give the person the 'Member' role'
        if (invite.uses == guest_uses) {
          let role = member.guild.roles.find(r => r.name === 'Member');
          member.addRole(role, 'Auto-added via bot.');
        } else {
          guest_uses = invite.uses;
        }
      }
    }
  });
});

// ================ On message ================
// Handler for responding to messages (a la slackbot).

client.on('message', message => {
  if (message.channel.id === pugPollChannelId) {
    // Only the poll should be posted in this channel.
    // If a new poll was posted then update the PUG poll variables.
    cur_pug_message = message;
    for (let [emoji_name, day] of valid_days) {
      max_day_counts.set(emoji_name, 0);
    }
    console.log('New PUG poll was posted.')
    return;
  }

  // Only respond to messages sent from real users and those that are
  // prefixed appropriatly.
  if (!message.content.startsWith(prefix) ||
      message.author.bot ||
      message.channel.name !== 'zerowatch-bot-testing') return;

  const args = message.content.slice(prefix.length).split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName) ||
                  client.commands.find(
                      cmd => cmd.aliases && cmd.aliases.includes(commandName));

  if (!command) return;

  // Sanity check for commands that require arguments.
  if (command.args && !args.length) {
    let reply = `You didnt provide any arguments, ${message.author}!`;

    if (command.usage) {
      reply += '\nThe proper usage would be: '
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

client.login(token);