const Discord = require('discord.js');

const kCharsPerMessage = 1000;
const kHeaderString = 'This channel stores a community collection of ' +
'BattleTags for quick reference.\nUse ' +
'\'[prefix] bnet [add|remove] [battleTag]\' in any channel to add or remove ' +
'a BattleTag from your account.\n';

const kSnowflakeRegex = new RegExp(/<@(\d+)>/);
const kBattleTagRegex = new RegExp(/.{3,12}#\d{4,5}/);
const kBattleTagOnlyRegex = new RegExp('^' + kBattleTagRegex.source + '$');
const kBattletagLineRegex = new RegExp('(.*): (' + kBattleTagRegex.source +
                                       ', )*('+ kBattleTagRegex.source+ ')');

let channelId = null;
let battleTags = null;
let modRoles = null;

/**
 * A class to store a set of BattleTags for a particular user or text key. Only
 * one of user and textId will be set. If the class is constructed with a
 * GuildMember the user object will be stored, otherwise the specified text key
 * will be stored.
 * @class
 *
 * @property {Discord.GuildMember} user The user object this entry is for
 * @property {string} textId The text ID this entry is for
 * @property {string[]} battleTags A list of BattleTags to start with
 */
class BattleTagEntry {
  /**
   * Constructor for BattleTagEntry. Only one of user and text should be set.
   * @constructor
   *
   * @param {Discord.GuildMember} user The user object to store
   * @param {string} textId The text ID to store
   * @param {string[]} battleTags A list of BattleTags to start with
   */
  constructor(user, textId, battleTags) {
    this.user = user;
    this.textId = textId;
    this.battleTags = new Set(battleTags);
  }

  /**
   * Adds a list of BattleTags to this BattleTagEntry. Duplicate tags will not
   * be added (case-sensitive).
   * @param {string[]} battleTags A list of BattleTags to add
   */
  append(battleTags) {
    this.battleTags.concat(battleTags);
  }

  /**
   * Removes a list of BattleTags from this BattleTagEntry (case-sensitive).
   * @param {string[]} battleTags A list of BattleTags to remove
   */
  remove(battleTags) {
    let battleTag;
    for (battleTag of battleTags) {
      if (this.battleTags.has(battleTag)) {
        this.battleTags.delete(battleTag);
      }
    }
  }

  /**
   * @return {number} Returns the number of BattleTags stored in this entry.
   */
  get numBattleTags() {
    return this.battleTags.size;
  }

  /**
   * Compares two BattleTagEntry's and for sorting.
   * @param {BattleTagEntry} a
   * @param {BattleTagEntry} b
   * @return {number} 0 if a and b are sorted equally, -1 if a should be sorted
   * before b, and 1 if a should be sorted after b.
   */
  static compare(a, b) {
    const cmpA = a.user ? a.user.displayName : a.textId;
    const cmpB = b.user ? b.user.displayName : b.textId;
    if (cmpA === cmpB) return 0;
    return cmpA < cmpB ? -1 : 1;
  }

  /**
   * @return {string} Returns the Snowflake string of the stored user if one
   * exists, or the text ID otherwise.
   */
  toIdString() {
    if (this.user) {
      return this.user.toString();
    }
    return this.textId;
  }

  /**
   * @return {string} Returns a pretty-printed line of text containing the ID
   * string and a list of BattleTags.
   */
  toEntryString() {
    return this.toIdString() + ': ' +
           Array.from(this.battleTags).sort().join(', ');
  }
}

/**
 * Retrieves the specified channel using the specified client.
 * @param {Discord.Client} client The client to use for querying
 * @param {string} channelId The snowflake for the channel to retrieve
 * @return {Discord.Channel} The channel retrieve, or null if it does not
 * exist.
 */
function getChannelById(client, channelId) {
  if (!client) {
    console.error('Error getting channel: No cilent specified');
    return null;
  }

  if (!channelId) {
    console.error('Error getting channel: No channel ID specified');
    return null;
  }

  const channel = client.channels.get(channelId);
  if (!channel) {
    console.error(`Error getting channel: Could not find channel with ` +
                  `ID ${channelId}`);
  }
  return channel;
};

/**
 * Adds all BattleTags in the BattleTags list to the entry for the specified
 * user or text key. User keys are their Snowflake ID. If an entry was storing
 * a text ID and a user is specified the text ID is overriden and the list of
 * BattleTags is reset.
 * @param {string} key The key of the user to add too
 * @param {(Discord.GuildMember|string)} userOrTextId The GuildMember or text ID
 * to store
 * @param {string[]} battleTagList A list of BattleTags to add
 */
function addBattleTags(key, userOrTextId, battleTagList) {
  let discordUser = null;
  let textId = null;
  if (userOrTextId instanceof Discord.GuildMember) {
    discordUser = userOrTextId;
  } else {
    textId = userOrTextId;
  }
  const debugString = discordUser ? discordUser.toString() : 'null';
  console.log(`Add BattleTag: ${key}, ${debugString}, ${textId}: ` +
              `${battleTagList}`);
  if (!battleTags.has(key)) {
    battleTags.set(key, new BattleTagEntry(discordUser, textId, battleTagList));
  } else {
    const existingEntry = battleTags.get(key);
    if (!discordUser && existingEntry.user) {
      return;
    } else if (discordUser && !existingEntry.user) {
      existingEntry.user = discordUser;
      existingEntry.textId = null;
      existingEntry.battleTags = new Set();
    }
    for (battleTag of battleTagList) {
      existingEntry.battleTags.add(battleTag);
    }
  }
};

/**
 * Removes all stored BattleTags in the BattleTags list from the entry for the
 * specified key.
 * @param {Discord.Channel} channel The channel to log to
 * @param {string} key The string key of the entry to remove from
 * @param {string[]} battleTagList A list of BattleTags to remove
 */
function removeBattleTags(channel, key, battleTagList) {
  console.log(`Remove BattleTag: ${key}: ${battleTagList}`);
  if (!battleTags.has(key)) {
    channel.send(`Could not find key ${key}`);
  }
  battleTags.get(key).remove(battleTagList);
  if (battleTags.get(key).numBattleTags == 0) {
    battleTags.delete(key);
  }
};

/**
 * Reloads and reprints the BattleTags in the BattleTags channel. Attempts to
 * parse BattleTags from all messages in the channel, including messages from
 * other users.
 * @param {Discord.Client} client The Client to fetch messages using
 * @param {Discord.Guild} guild The Guild to fetch members from
 * @param {string} channelId The Snowflake ID of the channel to retrive messages
 * from
 */
function reloadBattleTags(client, guild, channelId) {
  const channel = getChannelById(client, channelId);
  if (!channel) return;
  channel.fetchMessages().then((messages) => {
    battleTags = new Map();
    for (message of messages.values()) {
      for (line of message.content.split('\n')) {
        // TODO(aalberg) Improve the regex group capturing so we can skip some
        // of the string splitting.
        if (!line.match(kBattletagLineRegex)) continue;
        const userEntry = line.split(/:\s+/);
        const userSnowflake = parseSnowflake(userEntry[0]);
        const battleTagList = userEntry[1].split(/, /);
        if (userSnowflake) {
          guild.fetchMember(userSnowflake).then((user) => {
            if (user) {
              addBattleTags(userSnowflake, user, battleTagList);
            } else {
              addBattleTags(userEntry[0], userEntry[0], battleTagList);
            }
            printBattleTags(message.client, channelId);
          });
        } else {
          addBattleTags(userEntry[0], userEntry[0], battleTagList);
          printBattleTags(message.client, channelId);
        }
      }
    }
  });
};

/**
 * Prints all of the currently stored BattleTags in the appropriate channel.
 * Prefers editing exiting message to adding new ones, and removes messages by
 * other users in the channel.
 * @param {Discord.Client} client The Client to use to print
 * @param {string} channelId The Snowflake ID of the channel to print to
 */
function printBattleTags(client, channelId) {
  if (!battleTags) return;

  // Build a list of messages to write.
  const textMessages = [kHeaderString];
  for (entry of [...battleTags.entries()].map((e) => e[1])
      .sort(BattleTagEntry.compare)) {
    const line = entry.toEntryString();
    if (textMessages[textMessages.length - 1].length +
        line.length + 1 > kCharsPerMessage) {
      textMessages.push(line);
    } else {
      textMessages[textMessages.length - 1] += '\n' + line;
    }
  }

  // Get the current channel messages.
  const channel = getChannelById(client, channelId);
  if (!channel) return;
  channel.fetchMessages().then((messages) => {
    // Filter to self messages.
    const sortedMessages = [...messages.entries()].sort().map((e) => e[1]);
    const selfMessages = sortedMessages.filter(
        (m) => m.author.id === client.user.id);

    // Update the contents of the existing messages.
    for (i = 0; i < Math.min(selfMessages.length, textMessages.length); i++) {
      selfMessages[i].edit(textMessages[i]);
    }

    // Add messages as necessary.
    for (i = selfMessages.length; i < textMessages.length; i++) {
      channel.send(textMessages[i]);
    }

    // Delete extra self messages if necessary.
    for (i = textMessages.length; i < selfMessages.length; i++) {
      selfMessages[i].delete();
    }

    // Delete all other messages in the channel.
    for (message of sortedMessages.filter((m) =>
      m.author.id !== client.user.id)) {
      if (message.author.id !== client.user.id) {
        message.delete();
      }
    }
  });
};

/**
 * Parses a possible mention string into a Snowflake string.
 * @param {string} text The text to parse
 * @return {string} The extracted Snowflake, or null if the text is not a
 * mention.
 */
function parseSnowflake(text) {
  const userSnowflake = text.match(kSnowflakeRegex);
  return userSnowflake ? userSnowflake[1] : null;
}

/**
 * Parses a possible mention string into a Snowflake string.
 * @param {string} text The text to parse
 * @return {string} The extracted Snowflake, or the input if the text is not a
 * mention.
 */
function tryParseSnowflake(text) {
  const userSnowflake = text.match(kSnowflakeRegex);
  return userSnowflake ? userSnowflake[1] : text;
};

/**
 * Checks the permissions of a user against the required roles.
 * TODO(aalberg): Refactor this to a utility module.
 * @param {Discord.User} user The user to check
 * @param {string[]} requiredRoles The Snowflakes of the roles to check for
 * @return {bool} true if the specified GuildMemeber has one of the required
 * roles, and false otherwise.
 */
function checkPermissions(user, requiredRoles) {
  for (role of requiredRoles) {
    if (user.roles.has(role)) {
      return true;
    }
  }
  return false;
}

/**
 * Sanity checks the number and format of the args passed to this command. Logs
 * an error message to the channel if the check does not pass.
 * TODO(aalberg): Make this more generic and move to a util module.
 * @param {Discord.Channel} channel The channel to log to
 * @param {string[]} args The args to check
 * @param {number} expectedSize The expected number of args
 * @return {bool} true if the args pass the check and false otherwise
 */
function checkArgs(channel, args, expectedSize) {
  if (args.length > expectedSize) {
    channel.send(
        `Too many args, expected ${expectedSize} got ${args.length}`);
    return false;
  } else if (!args[args.length - 1].match(kBattleTagOnlyRegex)) {
    channel.send(`${args[args.length - 1]} is not a BattleTag, format is ` +
                 `<TagName>#<TagNumbers>`);
    return false;
  }
  return true;
};

module.exports = {
  name: 'bnet',
  usage: '[add|remove] [battleTag]',
  cooldown: 1,
  description: 'Battletag management',
  onStart(client, config) {
    console.log(`Starting ${this.name}`);
    channelId = config.args[this.name]['channelId'];
    modRoles = [];
    ['admin', 'mod'].forEach((r) => {
      if (config.roles[r]) {
        modRoles.push(config.roles[r]);
      }
    });
    reloadBattleTags(client, client.guilds.get(config.guildId), channelId);
  },
  execute(message, args) {
    if (!channelId) return;
    if (!message.guild) return;
    if (!battleTags) {
      message.channel.send(
          'BattleTags list has not been initialized. Please try again later');
      return;
    }

    // TODO(aalberg) Split this into functions.
    const subcommand = args.shift();
    switch (subcommand) {
      case 'reload':
        if (checkPermissions(message.member, modRoles)) {
          reloadBattleTags(message.client, message.guild, channelId);
        } else {
          message.channel.send('Permission denied');
        }
        break;
      case 'print':
        if (checkPermissions(message.member, modRoles)) {
          printBattleTags(message.client, channelId);
        } else {
          message.channel.send('Permission denied');
        }
        break;
      case 'add':
        if (checkArgs(message.channel, args, 2)) {
          addBattleTags(message.member.id, message.member, [args[0]]);
          printBattleTags(message.client, channelId);
        }
        message.delete();
        break;
      case 'remove':
        if (checkArgs(message.channel, args, 2)) {
          removeBattleTags(message.channel, message.member.id, [args[0]]);
          printBattleTags(message.client, channelId);
        }
        message.delete();
        break;
      case 'adminadd':
        if (checkPermissions(message.member, modRoles)) {
          if (checkArgs(message.channel, args, 3)) {
            const snowflake = parseSnowflake(args[0]);
            if (snowflake) {
              message.guild.fetchMember(snowflake).then((user) => {
                if (user) {
                  addBattleTags(snowflake, user, [args[1]]);
                } else {
                  addBattleTags(snowflake, snowflake, [args[1]]);
                }
                printBattleTags(message.client, channelId);
              });
            } else {
              addBattleTags(args[0], args[0], [args[1]]);
              printBattleTags(message.client, channelId);
            }
          }
        } else {
          message.channel.send('Permission denied');
        }
        break;
      case 'adminremove':
        if (checkPermissions(message.member, modRoles)) {
          if (checkArgs(message.channel, args, 3)) {
            removeBattleTags(message.channel, tryParseSnowflake(args[0]),
                [args[1]]);
            printBattleTags(message.client, channelId);
          }
        } else {
          message.channel.send('Permission denied');
        }
        break;
      default:
        message.channel.send(
            `Invalid subcommand ${subcommand} of command ${this.name}`);
    }
  },
};
