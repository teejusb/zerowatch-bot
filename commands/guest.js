const cron = require('cron');
const util = require('../util/util.js');

const kTimeoutLineRegex = new RegExp(util.kSnowflakeRegex.source +
    ': (\\d+)(, .*)?');

// Parameter objects.
// TODO(aalberg): It might make more sense to store one copy of the global
// config in util and export it from there, rather than requiring all modules
// to save the values they want.
// A reference to the Discord client used by this bot.
let discordClient = null;

// The channel to welcome new members in.
let welcomeChannelId = null;

// The channel ID to store timeouts in.
let timeoutChannelId = null;

// Temporary channel. Log here when timeouts have expired instead of actually
// removing people from the server.
let debugChannelId = null;

// The guest invite code.
let guestCode = null;

// The guest role snowflake.
let guestRole = null;

// Internal data objects.
// Keep track of existing guest invite usages.
// This is used to let the bot automatically assign roles if necessary.
let guestUses = 0;

// A map that maps users to timeouts to remove them from the server.
let timeoutMap = null;

// The cron object scheduled to remove guests when the guest window is over.
let timeoutCron = null;

/**
 * A class to store a set of BattleTags for a particular user or text key.
 * @class
 *
 * @property {Discord.GuildMember} user The user object this entry is for
 * @property {Date} timeout The time at which to remove the user from the
 * server
 */
class TimeoutEntry {
  /**
   * Constructor for TimeoutEntry. Only one of user and text should be set.
   * @constructor
   *
   * @param {Discord.GuildMember} user The user object to store
   * @param {Date} timeout The timeout date to store.
   */
  constructor(user, timeout) {
    this.user = user;
    this.timeout = timeout;
  }

  /**
   * Sets the current timeout to a new value.
   *
   * @param {Date} timeout The timeout date to store.
   */
  setTimeout(newTimeout) {
    this.timeout = newTimeout;
  }

  /**
   * Updates the current timeout to a new value if the new timeout is later in
   * time than the current one.
   *
   * @param {Date} timeout The timeout date to potentially store.
   */
  extendTimeout(newTimeout) {
    if (newTimeout > this.timeout) {
      this.timeout = newTimeout
    }
  }

  /**
   * @return {bool} true if the timeout is before the current time, false
   * otherwise.
   */
  expired() {
    return timeout > Date.now();
  }

  /**
   * Compares two TimeoutEntry's for sorting.
   * @param {TimeoutEntry} a
   * @param {TimeoutEntry} b
   * @return {number} 0 if a and b are sorted equally, -1 if a should be sorted
   * before b, and 1 if a should be sorted after b.
   */
  static compare(a, b) {
    return a.user.displayName.localeCompare(b.user.displayName, 'en',
        {sensitivity: 'base'});
  }

  /**
   * Compares two TimeoutEntry's for sorting.
   * @param {TimeoutEntry} a
   * @param {TimeoutEntry} b
   * @return {number} 0 if a and b are sorted equally, -1 if a should be sorted
   * before b, and 1 if a should be sorted after b.
   */
  static compareTimes(a, b) {
    return a.user.displayName.localeCompare(b.user.displayName, 'en',
        {sensitivity: 'base'});
  }

  /**
   * @return {string} Returns a pretty-printed line of text containing the ID
   * string and a list of BattleTags.
   */
  toEntryString() {
    return this.user.toString() + ': ' + this.timeout.getTime() + ', ' + this.timeout;
  }
};

/**
 * Add or update a timeout for a given user. The user will be removed from the
 * server when the timeout expires.
 * @param {GuildMember} user The user to add a timeout for.
 * @param {Date} timeout The timeout for the user.
 * @param {bool} extend Optional parameter. If true and a timeout is already
 * set, the timeout will only be updated if the new timeout is later in time
 * than the existing one. If false, timeout will always be updated.
 */
function addTimeout(user, timeout, extend = false) {
  const key = user.id;
  console.log(`Add timeout: ${key}: ${timeout}`);
  if (!timeoutMap.has(key)) {
    timeoutMap.set(key, new TimeoutEntry(user, timeout));
  } else if (extend) {
    timeoutMap.get(key).extendTimeout(timeout);
  } else {
    timeoutMap.get(key).setTimeout(timeout);
  } 
}

/**
 * Add or update a timeout for a given user. The user will be removed from the
 * server when the timeout expires. Also process existing timeouts.
 * @param {GuildMember} user The user to add a timeout for.
 * @param {Date} timeout The timeout for the user.
 */
function addTimeoutAndUpdate(user, timeout) {
  addTimeout(user, timeout);
  processTimeouts();
}

/**
 * Removes the timeout for a user with a given snowflake, if one exists.
 * @param {string} snowflake The snowflake of the user to remove a timeout for.
 * @return {bool} true if a timeout was removed, false otherwise.
 */
function removeTimeout(snowflake) {
  if (timeoutMap.has(snowflake)) {
    console.log(`Remove timeout: ${snowflake}`);
    timeoutMap.delete(snowflake);
    return true;
  }
  console.log(`Could not find key ${snowflake}`);
  return false;
};

/**
 * Removes the timeout for a user with a given snowflake, if one exists, and
 * processes the rest of the timeouts.
 * @param {string} snowflake The snowflake of the user to remove a timeout for.
 * @return {bool} true if a timeout was removed, false otherwise.
 */
function removeTimeoutAndUpdate(snowflake) {
  if (removeTimeout(snowflake)) {
    processTimeouts();
    return true;
  }
  return false;
}

/**
 * Remove a user from the server. The user will not be removed and their 
 * timeout will be cleared if they do not have the guest role. The timeout will
 * be extended for 1 hour if the user is in a voice channel at the time the
 * the timeout expires.
 * @param {TimeoutEntry} user_entry The TimeoutEntry containing the user and
 * timeout information.
 */
function removeUser(user_entry) {
  if (!user_entry.user.roles.has(guestRole)) {
    console.log(`User is not guest: ${user_entry.toEntryString()}`);
    // TODO(aalberg) Remove this debug statement when we're confident
    // everything is working correctly.
    const channel = util.getChannelById(discordClient, debugChannelId);
    if (util.exists(channel)) {
      channel.send(`User is not guest: ${user_entry.toEntryString()}`);
    }
    removeTimeout(user_entry.user.id);
    return;
  }
  console.log(`Voice channel ${user_entry.user.voiceChannel}`);
  if (util.exists(user_entry.user.voiceChannel)) {
    console.log(`Delaying kick of: ${user_entry.toEntryString()}`);
    // TODO(aalberg) Remove this debug statement when we're confident
    // everything is working correctly.
    const channel = util.getChannelById(discordClient, debugChannelId);
    if (util.exists(channel)) {
      channel.send(`Delaying kick of: ${user_entry.toEntryString()}`);
    }
    addTimeout(user_entry.user, util.addHours(new Date(), 1), true);
  } else {
    console.log(`Kicking: ${user_entry.toEntryString()}`);
    // TODO(aalberg): Update this to actually remove people when we're confident
    // everything is working correctly.
    const channel = util.getChannelById(discordClient, debugChannelId);
    if (util.exists(channel)) {
      channel.send(`Kicking: ${user_entry.toEntryString()}`);
    }
    removeTimeout(user_entry.user.id);
  }
}

/**
 * Sets the wakeup time of the cron job to the specified time and starts the
 * cron job.
 * @param {Date} time The wakeup time of the cron job.
 */
function setCronTimeout(time) {
  console.log('New cron time: ' + time);
  if (!util.exists(timeoutCron)) {
    timeoutCron = cron.job(time, processTimeouts);
  } else {
    timeoutCron.setTime(cron.time(time));
  }
  timeoutCron.start();
}

/**
 * Process all of the currently active timeouts and remove guests whos timeouts
 * have expired.
 */
function processTimeouts() {
  const timeouts = getSortedTimeouts();
  if (timeouts.length == 0) {
    printTimeouts(discordClient, timeoutChannelId);
    return;
  }
  let i = 0;
  // Mitigate a race condition with the cron job. The cron job throws an error
  // if the wake time is in the past, so remove people one minute early and hope
  // the cron gets started before the next closest time passes.
  const now = util.addMinutes(new Date(), 1);
  while (i < timeouts.length && timeouts[i].timeout < now) {
    removeUser(timeouts[i]);
    i++;
  }

  if (i < timeouts.length) {
    setCronTimeout(timeouts[i].timeout);
  } else {
    console.log('No more timeouts, not starting cron job');
  }

  printTimeouts(discordClient, timeoutChannelId);
}

/**
 * Gets the tiemout earliest in time from the timeout map.
 * @return {TimeoutEntry[]} A list of all TimeoutEntries sorted by the timeout
 * time. Returns an empty list if there are no active timeouts.
 */
function getSortedTimeouts() {
  if (!util.exists(timeoutMap) || timeoutMap.size <= 0) return [];
  return [...timeoutMap.entries()].map((e) => e[1])
      .sort(TimeoutEntry.compareTimes);
}

/**
 * Reloads and reprints the active timeouts in the appropriate channel.
 * Attempts to parse active timeouts from all messages in the channel,
 * including messages from other users.
 * @param {Discord.Client} client The Client to fetch messages using
 * @param {Discord.Guild} guild The Guild to fetch members from
 * @param {string} channelId The Snowflake ID of the channel to retrive messages
 * from
 */
async function reloadTimeouts(client, guild, channelId) {
  timeoutMap = new Map();
  callback = reloadTimeoutsCallback.bind(null, guild);
  await util.iterateChannelLines(client, channelId, callback);
  processTimeouts();
  printTimeouts(client, channelId);
}

/**
 * A callback to process a single line containing a timeout. Attempts to
 * parse a user snowflake and timestamp from the line and add them to the
 * existing map of TimeStampEntry's. Members are fectched from the provided
 * guild to use as map keys.
 * @param {Discord.Guild} guild The Guild to fetch members from.
 * @param {string} line The line to process.
 */
async function reloadTimeoutsCallback(guild, line) {
  result = line.match(kTimeoutLineRegex);
  if (!result) return;
  const userSnowflake = result[1];
  const time = new Date(Number(result[2]));
  if (isNaN(time.getTime())) {
    console.log('Got invalid timestamp: ' + result[2]);
    return;
  }

  let user = null;
  try {
    user = await guild.fetchMember(userSnowflake);
    addTimeout(user, time);
  } catch (e) {
    console.log(
        `ReloadTimeouts: No user with snowflake ${userSnowflake} found: ` +
        `${e.message}`);
  }
}

/**
 * Prints all of the currently stored server member timeouts in the appropriate
 * channel. Prefers editing exiting message to adding new ones, and removes
 * messages by other users in the channel.
 * @param {Discord.Client} client The Client to use to print
 * @param {string} channelId The Snowflake ID of the channel to print to
 */
function printTimeouts(client, channelId) {
  if (!timeoutMap) return;
  util.printLinesToChannel(client, channelId,
      printTimeoutsGenerator(timeoutMap));
};

/**
 * Generates a line for the BattleTag message header and each BattleTag in the
 * battleTags object.
 * @param {Map<TimeoutEntry>} timeouts The map to return lines from
 * @yields {string} A single line representing a TimeoutEntry
 */
function* printTimeoutsGenerator(timeouts) {
  for (entry of [...timeoutMap.entries()].map((e) => e[1])
      .sort(TimeoutEntry.compare)) {
    yield entry.toEntryString();
  }
};

/**
 * Sanity checks the number of args passed to this command. Logs an error
 * message to the channel if the check does not pass.
 * TODO(aalberg): Make this more generic and move to a util module.
 * @param {Discord.Channel} channel The channel to log to
 * @param {string[]} args The args to check
 * @param {number} expectedSize The expected number of args
 * @return {bool} true if the args pass the check and false otherwise
 */
function checkArgCount(channel, args, expectedSize) {
  if (args.length != expectedSize) {
    message.channel.send(`Wrong number of args, expected ${expectedSize}, ` +
        `got ${args.length}`);
    return false;
  }
  return true;
}

module.exports = {
  name: 'guest',
  onStart(client, config) {
    welcomeChannelId = config.welcomeChannelId;
    guestCode = config.guestCode;
    guestRole = config.roles.guest;
    timeoutChannelId = config.args.guest.channelId;
    debugChannelId = config.args.guest.debugChannelId;
    discordClient = client;

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
              if (code === guestCode) {
                guestUses = invite.uses;
              }
            }
          });
    }

    reloadTimeouts(client, guild, timeoutChannelId);
  },
  async onGuildMemberAdd(member) {
    const guildInvites = await member.guild.fetchInvites();
    const invite = guildInvites.get(guestCode);
    if (invite) {
      if (invite.uses == guestUses) {
        const role = member.guild.roles.find((r) => r.name === 'Member');
        member.addRole(role, 'Auto-added via bot.');
        const welcomeChannel =
            discordClient.channels.get(welcomeChannelId);
        if (welcomeChannel) {
          welcomeChannel.send(`Welcome ${member.toString()}!`)
              .catch(console.error);
        } else {
          console.log(`Could not find channel ${welcomeChannelId}`);
        }
      } else {
        guestUses = invite.uses;
        member.addRole(guestRole, 'Auto-added via bot.');
        addTimeoutAndUpdate(member, util.addDays(new Date(), 7));
      }
    }
  },
  async onMessageReactionAdd(messageReaction, user) {
    // TODO(aalberg) Update timeouts when a guest signs up for PUGs.
  },
  execute(message, args) {
    if (!timeoutChannelId) return;
    if (!message.guild) return;
    if (!timeoutMap) {
      message.channel.send(
          'Guest system has not been initialized. Please try again later');
      return;
    }

    if (!util.isMod(message.member)) {
      message.channel.send('Permission denied');
      return;
    }

    const subcommand = args.shift();
    switch (subcommand) {
      case 'reload':
        reloadTimeouts(discordClient, message.guild, timeoutChannelId);
        break;
      case 'print':
        printTimeouts(discordClient, timeoutChannelId);
        break;
      case 'process':
        processTimeouts();
        break;
      case 'add':
        if (checkArgCount(message.channel, args, 2)) {
          for (arg of args) {
            console.log(arg);
          }
          const snowflake = util.parseSnowflake(args[0]);
          const time = new Date(Number(args[1]));
          if (!util.exists(snowflake)) {
            message.channel.send(`${args[0]} is not a snowflake`);
          } else if (isNaN(time.getTime())) {
            message.channel.send('Invalid timestamp: ' + args[1]);
          } else {
            message.guild.fetchMember(snowflake).then((user) => {
              addTimeoutAndUpdate(user, time);
            }).catch((error) => {
              console.error(error);
              message.channel.send(
                  `No user with snowflake ${snowflake} found`);
            });
          }
        }
        break;
      case 'remove':
        if (checkArgCount(message.channel, args, 1)) {
          const snowflake = util.parseSnowflake(args[0]);
          if (util.exists(snowflake)) {
            if (removeTimeoutAndUpdate(snowflake)) {
              message.channel.send(`Removed timeout for user ${args[0]}`);
            } else {
              message.channel.send(`No timeout found for user ${args[0]}`);
            }
          } else {
            message.channel.send(`${args[0]} is not a snowflake`);
          }
        }
        break;
    }
  },
};
