const fs = require('fs');
const cron = require('cron');
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

const exists = (val) => {
  return (typeof val !== 'undefined' && val !== null);
};

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

// Keep track of current and previous PUG poll information.
let prevPugMessage = null;
let curPugMessage;

// A pretty useful method to create a delay without blocking the whole script.
const wait = require('util').promisify(setTimeout);

// Start a cron job that executes a function every hour on the hour.
// Currently we use this to:
//  - Delete the previous poll every Monday at Midnight.
//  - Post the new PUG poll every Sunday at 12 PM PST.
//  - Check the current votes to see if we have quorum at 5PM PST.
const hourPoller = cron.job('0 0 * * * *', function() {
  const curDate = new Date();
  if (curDate.getHours() === 0) {
    // Delete the previous poll on Monday at Midnight.
    if (curDate.getDay() === 1) {
      const pugPollChannel = client.channels.get(config.pugPollChannelId);
      if (pugPollChannel && exists(prevPugMessage)) {
        pugPollChannel.fetchMessage(prevPugMessage.id)
            .then((message) => {
              message.delete();
              prevPugMessage = null;
            });
      } else {
        console.log(
            'ERROR: Could not find PUG poll channel when creating new poll.');
      }
    }
  } else if (curDate.getHours() === 12) {
    // If it's Sunday at 12 PM PST, post a new PUG poll.
    if (curDate.getDay() === 0) {
      const oneWeekFromNow = new Date();
      oneWeekFromNow.setDate(curDate.getDate() + 7);

      let pugPollText = '**PUG Availability Poll for ';
      if (curDate.getMonth() == oneWeekFromNow.getMonth()) {
        // E.g. Jan 7-13
        pugPollText +=
            `${curDate.toLocaleString('en-us', {month: 'short'})} ` +
            `${curDate.getDate()}-${oneWeekFromNow.getDate()}**\n`;
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
          '(generally 8PM PST). Feel free to add/remove votes over the ' +
          'week but please refrain from removing votes the day of:\n' +
          '\n'+
          '🇲 - Monday\n' +
          '🇹 - Tuesday\n' +
          '🇼 - Wednesday\n' +
          '🇷 - Thursday\n' +
          '🇫 - Friday\n' +
          '🇸 - Saturday\n' +
          '🇺 - Sunday\n';

      const pugPollChannel = client.channels.get(config.pugPollChannelId);
      if (pugPollChannel) {
        pugPollChannel.send(pugPollText);
      } else {
        console.log(
            'ERROR: Could not find PUG poll channel when creating new poll.');
      }

      // Delete all messages in the PUG announce channel to minimize clutter.
      const pugAnnounceChannel =
          client.channels.get(config.pugAnnounceChannelId);
      if (pugAnnounceChannel) {
        pugAnnounceChannel.fetchMessages()
            .then((fetchedMessages) => {
              pugAnnounceChannel.bulkDelete(fetchedMessages);
            });
      } else {
        console.log(
            'ERROR: Could not find PUG announce channel.');
      }
    }
  } else if (curDate.getHours() === 17) {
    // Refetch the PUG poll to get updated values.
    const pugPollChannel = client.channels.get(config.pugPollChannelId);
    let pugMessage;
    if (pugPollChannel) {
      let pugMessageId;
      if (exists(prevPugMessage)) {
        pugMessageId = prevPugMessage.id;
      } else if (exists(curPugMessage)) {
        pugMessageId = curPugMessage.id;
      }

      if (pugMessageId) {
        // The last message posted is the current poll.
        pugPollChannel.fetchMessage(pugMessageId)
            .then((message) => {
              pugMessage = message;
            });
      }
    } else {
      console.log('ERROR: Couldn\'t find PUG poll channel.');
    }

    if (exists(pugMessage)) {
      // At 5 PM PST on every day, determine if we have enough for PUGs today.
      // curDate.getDay() is 0-indexed where 0 = Sunday.
      const days = ['🇺', '🇲', '🇹', '🇼', '🇷', '🇫', '🇸'];
      for (const reaction of pugMessage.reactions.values()) {
        if (reaction.emoji.name === days[curDate.getDay()]) {
          reaction.fetchUsers().then((reactedUsers) => {
            if (reactedUsers.size >= 12) {
              const pugAnnounce =
                  client.channels.get(config.pugAnnounceChannelId);
              pugAnnounce.send(
                  `PUGs are happening today `
                + `(${validDays.get(days[curDate.getDay()])}) in 3 hours! `
                + `Please mark your availability over at `
                + `https:\/\/zerowatch-pugs.firebaseapp.com/`);
            }
          });
        }
      }
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
    // The last two messages posted are the current and previous polls.
    // If there is only one message, then we keep track of just the one.
    pugPollChannel.fetchMessages({limit: 2})
        .then((messages) => {
          if (messages.size === 2) {
            // The messages may not be sorted.
            // Set the poll variables appropriately.
            const first = messages.first();
            const last = messages.last();
            if (first.createdTimestamp < last.createdTimestamp) {
              prevPugMessage = first;
              curPugMessage = last;
            } else {
              prevPugMessage = last;
              curPugMessage = first;
            }
          } else {
            curPugMessage = messages.first();
          }
          console.log(`Found ${messages.size} PUG message(s)!`);
        });
  }

  console.log('Ready!');
});

// The functionality for adding and removing reactions is essentially the same.
// Condense it to this one function and rely on 'mode' to handle the
// differences.
const messageReactionResponse = async (
  messageReaction, user, pugMessage, mode) => {
  if (mode != 'add' && mode != 'remove') return;

  // If we can't find the requested PUG poll for whatever reason, return early.
  if (!exists(pugMessage)) return;

  // We only care for reactions to the requested PUG poll.
  if (messageReaction.message.id !== pugMessage.id) return;

  // If a bot added/removed the reaction, we can return early.
  if (user.bot) return;

  const emojiName = messageReaction.emoji.name;

  // If people reacted to to the PUG poll with a non-valid reaction,
  // just remove it.
  if (!validDays.has(emojiName)) {
    messageReaction.remove(user);
    return;
  }

  if (mode === 'add') {
    console.log(`${user.username} has responded to PUGs `
              + `for ${validDays.get(emojiName)}`);
  } else if (mode === 'remove') {
    console.log(`${user.username} has removed their PUG vote `
            + `for ${validDays.get(emojiName)}`);
  }

  const curDate = new Date();
  // curDate.getDay() is 0-indexed where 0 = Sunday.
  const days = ['🇺', '🇲', '🇹', '🇼', '🇷', '🇫', '🇸'];
  // messageReaction.count can be wrong because of caching. We'll just
  // actively fetch the users and get the size from there.
  // Only post these messages between 5PM PST and 8PM PST on the day of
  // the PUGs to minimize spam. 8PM PST is the usual start time for PUGs.
  if (days[curDate.getDay()] === emojiName &&
      17 <= curDate.getHours() && curDate.getHours() <= 20) {
    const reactedUsers = await messageReaction.fetchUsers();
    const pugAnnounce = client.channels.get(config.pugAnnounceChannelId);

    // If we hit 12, then that means we incremented from 11.
    if (mode === 'add' && reactedUsers.size === 12) {
      pugAnnounce.send(`PUGs are on for ${validDays.get(emojiName)}!`);
    // If we dropped below the threshold then notify users that we've lost
    // quorum for that day.
    // If we hit 11, then that means we decremented from 12.
    } else if (mode === 'remove' && reactedUsers.size === 11) {
      pugAnnounce.send(`We no longer have enough for PUGs `
                     + `on ${validDays.get(emojiName)} :(`);
    }
  }
};

// ================ On messageReactionAdd ================
// Handler for when members react to the PUG poll.

client.on('messageReactionAdd', async (messageReaction, user) => {
  if (exists(prevPugMessage)) {
    messageReactionResponse(messageReaction, user, prevPugMessage, 'add');
  } else if (exists(curPugMessage)) {
    messageReactionResponse(messageReaction, user, curPugMessage, 'add');
  }
});

// ================ On messageReactionRemove ================
// Handler for when members remove reactions to the PUG poll.

client.on('messageReactionRemove', async (messageReaction, user) => {
  if (exists(prevPugMessage)) {
    messageReactionResponse(messageReaction, user, prevPugMessage, 'remove');
  } else if (exists(curPugMessage)) {
    messageReactionResponse(messageReaction, user, curPugMessage, 'remove');
  }
});


// ================ On guildMemberAdd ================
// Handler for when new members join the server.

client.on('guildMemberAdd', (member) => {
  member.guild.fetchInvites().then((guildInvites) => {
    const invite = guildInvites.get(config.guestCode);
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
  if (message.channel.id === config.pugPollChannelId) {
    // Only the poll should be posted in this channel.
    // If a new poll was posted then reset the PUG poll variables.
    prevPugMessage = curPugMessage;
    curPugMessage = message;
    console.log('New PUG poll was posted.');
    return;
  }

  // Only respond to messages sent from real users and those that are
  // config.prefixed appropriatly.
  if (!message.content.startsWith(config.prefix) ||
      message.author.bot) return;

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
      let timeLeft = (expirationTime - now) / 1000;
      if (timeLeft > 60) {
        timeLeft /= 60;
        return message.reply(
            `please wait ${timeLeft.toFixed(1)} more minute(s) `
          + `before reusing the \`${command.name}\` command.`);
      } else {
        return message.reply(
            `please wait ${timeLeft.toFixed(1)} more second(s) `
          + `before reusing the \`${command.name}\` command.`);
      }
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

client.on('error', (e) => console.error(e.name + ': ' + e.message));
client.on('warn', (e) => console.warn(e.name + ': ' + e.message));
client.on('debug', (e) => {});

client.login(token);
