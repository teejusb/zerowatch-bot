const fs = require('fs');
const Discord = require('discord.js');
const util = require('./util/util.js');

// TODO(aalberg): Use JSON.parse and maybe some more complex handling here.
const privateConfig = require('./config_private.json');
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

// A pretty useful method to create a delay without blocking the whole script.
const wait = require('util').promisify(setTimeout);

// ================ Once on Startup ================

client.once('ready', () => {
  // "ready" isn't really ready. We need to wait a spell.
  // NOTE(teejusb): Not sure if this is necessary, but it was recommended here:
  // https://github.com/AnIdiotsGuide/discordjs-bot-guide/blob/master/coding-guides/tracking-used-invites.md
  // It's probably used to wait while the fetchInvites promise completes.
  wait(1000);

  // Initialize all of the commands.
  for (const entry of client.commands) {
    const command = entry[1];
    if (util.exists(command.onStart)) {
      command.onStart(client, config, privateConfig);
    }
  }

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

  console.log('Ready!');
});

// ================ On messageReactionAdd ================
// Handler for when members react to the PUG poll.

client.on('messageReactionAdd', async (messageReaction, user) => {
  for (const entry of client.commands) {
    const command = entry[1];
    if (util.exists(command.onMessageReactionAdd)) {
      command.onMessageReactionAdd(messageReaction, user);
    }
  }
});

// ================ On messageReactionRemove ================
// Handler for when members remove reactions to the PUG poll.

client.on('messageReactionRemove', async (messageReaction, user) => {
  for (const entry of client.commands) {
    const command = entry[1];
    if (util.exists(command.onMessageReactionRemove)) {
      command.onMessageReactionRemove(messageReaction, user);
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
        const welcomeChannel =
            client.channels.get(config.welcomeChannelId);
        if (welcomeChannel) {
          welcomeChannel.send(`Welcome ${member.toString()}!`)
              .catch(console.error);
        } else {
          console.log(`Could not find channel ${config.welcomeChannelId}`);
        }
      } else {
        guestUses = invite.uses;
      }
    }
  });
  
  for (const entry of client.commands) {
    const command = entry[1];
    if (util.exists(command.onGuildMemberAdd)) {
      command.onGuildMemberAdd(member);
    }
  }
});

// ================ On message ================
// Handler for responding to messages (a la slackbot).

client.on('message', (message) => {
  // Forward the message to all commands for generic operations.
  for (const entry of client.commands) {
    const command = entry[1];
    if (util.exists(command.onMessage)) {
      command.onMessage(message);
    }
  }

  // Conditionally forward the message to commands to execute.
  // Only respond to messages sent from real users and those that are
  // config.prefixed appropriatly.
  if (!message.content.startsWith(config.prefix) ||
      message.author.bot) return;

  // Regex soup from: https://stackoverflow.com/a/25663729
  // Capture args within ""s as a single arg, and also strip the ""s.
  const args = message.content.slice(config.prefix.length).trim()
      .split(/ +(?=(?:(?:[^"]*"){2})*[^"]*$)/g).map((e) => {
        if (e[0] === '"' && e[e.length - 1] === '"') return e.slice(1, -1);
        else return e;
      });
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName) ||
                  client.commands.find(
                      (cmd) => cmd.aliases &&
                          cmd.aliases.includes(commandName));

  if (!command) {
    console.log(`no command ${commandName}`);
    return;
  }

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
  if (util.exists(command.execute)) {
    try {
      command.execute(message, args);
    } catch (error) {
      console.error(error);
      message.reply('there was an error trying to execute that command!');
    }
  }
});

client.on('error', (e) => console.error(e.name + ': ' + e.message));
client.on('warn', (e) => console.warn(e.name + ': ' + e.message));
client.on('debug', (e) => {});

client.login(privateConfig.token);
