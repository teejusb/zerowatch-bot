const util = require('../util/util.js');

let kHeaderString = 'This channel stores a community collection of ' +
'BattleTags for quick reference.\nUse ' +
'\'{prefix}bnet add|remove battleTag#numbers\' in any channel to add or ' +
'remove a BattleTag from your account.\n';

const kBattleTagRegex = new RegExp(/.{1,12}#\d{4,6}/);
const kBattleTagOnlyRegex = new RegExp('^' + kBattleTagRegex.source + '$');
const kBattletagLineRegex = new RegExp(
    util.kSnowflakeRegex.source + ': (' + kBattleTagRegex.source + ', )*('+
    kBattleTagRegex.source + ')');

let channelId = null;
let battleTags = null;
let modRoles = null;

/**
 * A class to store a set of BattleTags for a particular user or text key.
 * @class
 *
 * @property {Discord.GuildMember} user The user object this entry is for
 * @property {Set<string>} battleTags The set of BattleTags for this user
 */
class BattleTagEntry {
  /**
   * Constructor for BattleTagEntry.
   * @constructor
   *
   * @param {Discord.GuildMember} user The user object to store
   * @param {string[]} battleTags A list of BattleTags to start with
   */
  constructor(user, battleTags) {
    this.user = user;
    this.battleTags = new Set(battleTags);
  }

  /**
   * Adds a list of BattleTags to this BattleTagEntry. Duplicate tags will not
   * be added (case-sensitive).
   * @param {string[]} battleTags A list of BattleTags to add
   */
  addAll(battleTags) {
    for (const battleTag of battleTags) {
      this.battleTags.add(battleTag);
    }
  }

  /**
   * Removes a list of BattleTags from this BattleTagEntry (case-sensitive).
   * @param {string[]} battleTags A list of BattleTags to remove
   * @return {bool} true if all BattleTags were present in the list of
   * BattleTags for the provided key, and false otherwise.
   */
  removeAll(battleTags) {
    let ret = true;
    for (const battleTag of battleTags) {
      if (this.battleTags.has(battleTag)) {
        this.battleTags.delete(battleTag);
      } else {
        ret = false;
      }
    }
    return ret;
  }

  /**
   * @return {number} Returns the number of BattleTags stored in this entry.
   */
  get numBattleTags() {
    return this.battleTags.size;
  }

  /**
   * Compares two BattleTagEntry's for sorting.
   * @param {BattleTagEntry} a
   * @param {BattleTagEntry} b
   * @return {number} 0 if a and b are sorted equally, -1 if a should be sorted
   * before b, and 1 if a should be sorted after b.
   */
  static compare(a, b) {
    return a.user.displayName.localeCompare(b.user.displayName, 'en',
        {sensitivity: 'base'});
  }

  /**
   * @return {string} Returns a pretty-printed line of text containing the ID
   * string and a list of BattleTags.
   */
  toEntryString() {
    return this.user.toString() + ': ' +
           Array.from(this.battleTags).sort().join(', ');
  }
}

/**
 * Adds all BattleTags in the BattleTags list to the entry for the specified
 * user. User keys are their Snowflake ID.
 * @param {Discord.GuildMember} user The GuildMember to store
 * @param {string[]} battleTagList A list of BattleTags to add
 */
function addBattleTags(user, battleTagList) {
  const key = user.id;
  console.log(`Add BattleTag: ${key}: ${battleTagList}`);
  if (!battleTags.has(key)) {
    battleTags.set(key, new BattleTagEntry(user, battleTagList));
  } else {
    battleTags.get(key).addAll(battleTagList);
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
  if (!battleTags.get(key).removeAll(battleTagList)) {
    channel.send(`Some BattleTags in remove list did not exist`);
  }
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
async function reloadBattleTags(client, guild, channelId) {
  battleTags = new Map();
  callback = reloadBattleTagsCallback.bind(null, guild);
  await util.iterateChannelLines(client, channelId, callback);
  printBattleTags(client, channelId);
}

/**
 * A callback to process a single line containing a BattleTag. Attempts to
 * parse BattleTags from the line and add them to the existing map of
 * BattleTagEntry's. Members are fectched from the provided guild to use as map
 * keys.
 * @param {Discord.Guild} guild The Guild to fetch members from.
 * @param {string} line The line to process.
 */
async function reloadBattleTagsCallback(guild, line) {
  // TODO(aalberg) Improve the regex group capturing so we can skip some
  // of the string splitting.
  if (!line.match(kBattletagLineRegex)) return;
  const userEntry = line.split(/:\s+/);
  const userSnowflake = util.parseSnowflake(userEntry[0]);
  if (userSnowflake) {
    try {
      const user = await guild.fetchMember(userSnowflake);
      addBattleTags(user, userEntry[1].split(/, /));
    } catch (e) {
      console.log(
          `ReloadBattleTags: No user with snowflake ${userSnowflake} found: ` + 
          `${e.message}`);
    }
  }
}

/**
 * Prints all of the currently stored BattleTags in the appropriate channel.
 * @param {Discord.Client} client The Client to use to print
 * @param {string} channelId The Snowflake ID of the channel to print to
 */
function printBattleTags(client, channelId) {
  if (!battleTags) return;
  util.printLinesToChannel(client, channelId,
      battleTagLineGenerator(battleTags));
};

/**
 * Generates a line for the BattleTag message header and each BattleTag in the
 * battleTags object.
 * @param {Map<BattleTagEntry>} battleTags The map to return lines from
 * @yields {string} A single line, either the message header or a line
 * represending a BattleTag entry.
 */
function* battleTagLineGenerator(battleTags) {
  yield kHeaderString;
  for (entry of [...battleTags.entries()].map((e) => e[1])
      .sort(BattleTagEntry.compare)) {
    yield entry.toEntryString();
  }
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
  onStart(client, config, privateConfig) {
    console.log(`Starting ${this.name}`);
    kHeaderString = kHeaderString.replace('{prefix}', config.prefix);
    channelId = config.args[this.name].channelId;
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
        if (util.checkPermissions(message.member, modRoles)) {
          reloadBattleTags(message.client, message.guild, channelId);
        } else {
          message.channel.send('Permission denied');
        }
        break;
      case 'print':
        if (util.checkPermissions(message.member, modRoles)) {
          printBattleTags(message.client, channelId);
        } else {
          message.channel.send('Permission denied');
        }
        break;
      case 'add':
        if (checkArgs(message.channel, args, 1)) {
          addBattleTags(message.member, [args[0]]);
          printBattleTags(message.client, channelId);
        }
        message.delete();
        break;
      case 'remove':
        if (checkArgs(message.channel, args, 1)) {
          removeBattleTags(message.channel, message.member.id, [args[0]]);
          printBattleTags(message.client, channelId);
        }
        message.delete();
        break;
      case 'adminadd':
        if (util.checkPermissions(message.member, modRoles)) {
          if (checkArgs(message.channel, args, 2)) {
            const snowflake = util.parseSnowflake(args[0]);
            if (snowflake) {
              message.guild.fetchMember(snowflake).then((user) => {
                addBattleTags(user, [args[1]]);
                printBattleTags(message.client, channelId);
              }).catch((error) => {
                console.error(error);
                message.channel.send(
                    `No user with snowflake ${args[0]} found`);
              });
            } else {
              message.channel.send(`${args[0]} is not a snowflake`);
            }
          }
        } else {
          message.channel.send('Permission denied');
        }
        break;
      case 'adminremove':
        if (util.checkPermissions(message.member, modRoles)) {
          if (checkArgs(message.channel, args, 2)) {
            const snowflake = util.parseSnowflake(args[0]);
            if (snowflake) {
              removeBattleTags(message.channel, snowflake, [args[1]]);
              printBattleTags(message.client, channelId);
            } else {
              message.channel.send(`${args[0]} is not a snowflake`);
            }
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
