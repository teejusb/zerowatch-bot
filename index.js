const fs = require('fs');
const Discord = require('discord.js');
const { prefix, token, guildId, guestCode } = require('./config.json');

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
// This is used to let to bot automatically assign roles if necessary.
let guest_uses = 0;

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
          for (var [code, invite] of guildInvites) {
            console.log(`  Available invite code ${code} with ${invite.uses} uses`);
            // Only need to keep track of guest invite usages.
            if (code === guestCode) {
              guest_uses = invite.uses;
            }
          }
        });
  }

  console.log('Ready!');
});

// ================ On guildMemberAdd ================
// Handler for when new members join the server.

client.on('guildMemberAdd', member => {
  member.guild.fetchInvites().then(guildInvites => {
    for (var [code, invite] of guildInvites) {
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