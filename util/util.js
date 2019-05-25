const kCharsPerMessage = 1000;
const kSnowflakeRegex = new RegExp(/<@!?(\d+)>/);

/**
 * Parses a possible mention string into a Snowflake string.
 * @param {string} text The text to parse
 * @return {string} The extracted Snowflake, or null if the text is not a
 * mention.
 */
function parseSnowflake(text) {
  const userSnowflake = text.match(kSnowflakeRegex);
  return userSnowflake ? userSnowflake[1] : null;
};

/**
 * Retrieves the specified channel using the specified client.
 * @param {Discord.Client} client The client to use for querying
 * @param {string} channelId The snowflake for the channel to retrieve
 * @return {Discord.Channel} The channel retrieve, or null if it does not
 * exist.
 */
function getChannelById(client, channelId) {
  if (!client) {
    console.error('Error getting channel: No client specified');
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
 * Generates a string for each line in each message in a specified channel.
 * @param {Discord.Client} client The Client to fetch messages using
 * @param {string} channelId The Snowflake ID of the channel to retrive messages
 * @param {function(string)} callback The callback to call for each line. This
 * function may be async.
 * @yields {string} A single line, representing a single line from a single
 * message from the specified channel.
 */
async function iterateChannelLines(client, channelId, callback) {
  const channel = getChannelById(client, channelId);
  if (!channel) return;
  let messages;
  try {
    messages = await channel.fetchMessages();
  } catch (e) {
    console.error(e.message);
    return;
  }

  for (message of messages.values()) {
    for (line of message.content.split('\n')) {
      await callback(line);
    }
  }
};

/**
 * Prints a generated set of lines to a text channel. Prefers editing exiting
 * messages to adding new ones, and removes messages by other users in
 * the channel.
 * @param {Discord.Client} client The Client to use to print
 * @param {string} channelId The Snowflake ID of the channel to print to
 * @param {generator} gen The generator function to get lines from
 */
function printLinesToChannel(client, channelId, gen) {
  const textMessages = [];
  for (line of gen) {
    const line = genOutput.value;
    if (textMessages[textMessages.length - 1].length +
        line.length + 1 > kCharsPerMessage) {
      textMessages.push(line);
    } else {
      textMessages[textMessages.length - 1] += '\n' + line;
    }
  }

  printMessagesToChannel(client, channelId, textMessages);
};

/**
 * Prints a list of messages to a text channel. Prefers editing exiting
 * messages to adding new ones, and removes messages by other users in
 * the channel. Each message must be less than the maximum number of allowed
 * characters in a single Discord message.
 * @param {Discord.Client} client The Client to use to print
 * @param {string} channelId The Snowflake ID of the channel to print to
 * @param {string[]} textMessages The lines to print to the channel
 */
function printMessagesToChannel(client, channelId, textMessages) {
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
  }).catch(console.error);
};

module.exports = {
  kCharsPerMessage,
  kSnowflakeRegex,
  parseSnowflake,
  getChannelById,
  iterateChannelLines,
  printLinesToChannel,
  printMessagesToChannel,
  exists(val) {
    return (typeof val !== 'undefined' && val !== null);
  },
};
