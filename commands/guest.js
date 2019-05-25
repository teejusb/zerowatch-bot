const cron = require('cron');
const util = require('../util/util.js');

const kMemberAddDelay = 10000;
const kTimeoutLineRegex = new RegExp(util.kSnowflakeRegex.source +
    ': (\d+), (.*)');

let timeoutMap = null;

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
    this.timeout = timeout;
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
   * @return {string} Returns a pretty-printed line of text containing the ID
   * string and a list of BattleTags.
   */
  toEntryString() {
    return this.user.toString() + ': 0';
  }
};

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
  printBattleTags(client, channelId);
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
  const time = new Date(Number(result[2]);
  if (isNaN(time.getTime())) {
    console.log("Got invalid timestamp: " + result[2]);
    return;
  }

  try {
    const user = await guild.fetchMember(userSnowflake);
    // XXX Do something with this.
    console.log(user + " " + time);
  } catch (e) {
    console.error(e.message);
    message.channel.send(
        `No user with snowflake ${userSnowflake} found`);
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
function printTimeoutsGenerator(timeouts) {
  for (entry of [...timeoutMap.entries()].map((e) => e[1])
      .sort(TimeoutEntry.compare)) {
    yield entry.toEntryString();
  }
};

module.exports = {
  name: 'guest',
  onStart(client, config) {
  },
  async onGuildMemberAdd(member) {
    // Wait for other modules to add roles.
    wait(kMemberAddDelay);
  },
  async onMessageReactionAdd(messageReaction, user) {
  },
  async onMessageReactionRemove(messageReaction, user) {
  },
};
