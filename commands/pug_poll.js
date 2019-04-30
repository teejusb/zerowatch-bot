const cron = require('cron');
const util = require('../util/util.js');

const validDays = new Map();
validDays.set('🇲', 'Monday');
validDays.set('🇹', 'Tuesday');
validDays.set('🇼', 'Wednesday');
validDays.set('🇷', 'Thursday');
validDays.set('🇫', 'Friday');
validDays.set('🇸', 'Saturday');
validDays.set('🇺', 'Sunday');

// Store a reference to the client.
let discordClient = null;

// Cron job to manage periodic things.
const hourPoller = cron.job('0 0 * * * *', doPeriodicTasks);

/**
 * Currently we use this to:
 *  - Delete the previous poll every Monday at Midnight.
 *  - Post the new PUG poll every Sunday at 12 PM PST.
 *  - Check the current votes to see if we have quorum at 5PM PST.
 */
async function doPeriodicTasks() {
  if (!util.exists(discordClient)) {
    console.log('No client');
    return;
  }
  if (!util.exists(module.exports.pugPollChannelId)) {
    console.log('Pug Poll Channel ID not found');
    return;
  }
  if (!util.exists(module.exports.pugAnnounceChannelId)) {
    console.log('Pug Announce Channel ID not found');
    return;
  }

  const curDate = new Date();

  if (curDate.getHours() === 0) {
    if (curDate.getDay() === 1) {
      // Delete the previous poll on Monday at Midnight.
      deletePreviousPoll();
    }
  } else if (curDate.getHours() === 12) {
    if (curDate.getDay() === 0) {
      // If it's Sunday at 12 PM PST, post a new PUG poll. The poll starts from
      // the next day because we post a day early.
      const tomorrow = new Date();
      tomorrow.setDate(curDate.getDate() + 1);
      postPoll(tomorrow);
    }
  } else if (curDate.getHours() === 17) {
    announcePug();
  }
};

/**
 * Delete the previous PUG poll.
 */
function deletePreviousPoll() {
  console.log('Attempting to delete previous PUG poll...');
  const pugPollChannel =
      discordClient.channels.get(module.exports.pugPollChannelId);
  if (pugPollChannel && util.exists(module.exports.prevPugMessage)) {
    pugPollChannel.fetchMessage(module.exports.prevPugMessage.id)
        .then((message) => {
          message.delete();
          module.exports.prevPugMessage = null;
          console.log('Deleted previous PUG poll.');
        });

    // Delete all messages in the PUG announce channel to minimize clutter.
    const pugAnnounceChannel =
        discordClient.channels.get(module.exports.pugAnnounceChannelId);
    if (pugAnnounceChannel) {
      pugAnnounceChannel.fetchMessages()
          .then((fetchedMessages) => {
            pugAnnounceChannel.bulkDelete(fetchedMessages);
            console.log('Cleared PUG announce channel.');
          });
    } else {
      console.log('ERROR: Could not find PUG announce channel to delete ' +
                  'messages from.');
    }
  } else {
    console.log(
        'ERROR: Could not find PUG poll channel when creating new poll.');
  }
}

/**
 * Post a new PUG poll.
 * @param {Date} weekday A day in the week of the week to post the poll for.
 * Polls will always start from Monday.
 */
async function postPoll(weekday) {
  console.log('Attempting to post a new PUG poll...');
  const monday = getMonday(weekday);
  const oneWeekFromMonday = new Date(monday);
  oneWeekFromMonday.setDate(monday.getDate() + 6);

  let pugPollText = '**PUG Availability Poll for ';
  if (monday.getMonth() == oneWeekFromMonday.getMonth()) {
    // E.g. Jan 7-13
    pugPollText +=
        `${monday.toLocaleString('en-us', {month: 'short'})} ` +
        `${monday.getDate()}-${oneWeekFromMonday.getDate()}**\n`;
  } else {
    // E.g. Jan 31-Feb 6
    pugPollText +=
        `${monday.toLocaleString('en-us', {month: 'short'})} ` +
        `${monday.getDate()}-` +
        `${oneWeekFromMonday.toLocaleString('en-us', {month: 'short'})} ` +
        `${oneWeekFromMonday.getDate()}**\n`;
  }

  pugPollText +=
      'Please vote with your availibility with the following reactions ' +
      '(generally 8PM PST). Feel free to add/remove votes over the ' +
      'week. Please try to keep your availability status up to date, ' +
      'people will frequently try to find extra players if the poll is ' +
      '>=10 votes:\n' +
      '\n'+
      '🇲 - Monday\n' +
      '🇹 - Tuesday\n' +
      '🇼 - Wednesday\n' +
      '🇷 - Thursday\n' +
      '🇫 - Friday\n' +
      '🇸 - Saturday\n' +
      '🇺 - Sunday\n';

  const pugPollChannel =
      discordClient.channels.get(module.exports.pugPollChannelId);
  if (pugPollChannel) {
    pugPollChannel.send(pugPollText).then(async (message) => {
      // Let the bot add reactions in order on the poll.
      await message.react('🇲');
      await message.react('🇹');
      await message.react('🇼');
      await message.react('🇷');
      await message.react('🇫');
      await message.react('🇸');
      await message.react('🇺');
    });
  } else {
    console.log(
        'ERROR: Could not find PUG poll channel when creating new poll.');
  }
}

/**
 * Announce the PUG.
 * @param {number} day The current day of the week.
 */
async function announcePug(day) {
  console.log('Checking current PUG poll...');
  // If it is 5pm and we have enough votes, send the announce message.
  // Refetch the PUG poll to get updated values.
  const pugPollChannel =
      discordClient.channels.get(module.exports.pugPollChannelId);
  let pugMessage;
  if (pugPollChannel) {
    if (util.exists(module.exports.prevPugMessage)) {
      pugMessage =
          await pugPollChannel.fetchMessage(module.exports.prevPugMessage.id);
    } else if (util.exists(module.exports.curPugMessage)) {
      pugMessage =
          await pugPollChannel.fetchMessage(module.exports.curPugMessage.id);
    } else {
      console.log('ERROR: Couldn\'t fetch current poll info.');
    }
  } else {
    console.log('ERROR: Couldn\'t find PUG poll channel.');
  }

  if (util.exists(pugMessage)) {
    // At 5 PM PST on every day, determine if we have enough for PUGs today.
    // day is 0-indexed where 0 = Sunday.
    const days = ['🇺', '🇲', '🇹', '🇼', '🇷', '🇫', '🇸'];
    for (const reaction of pugMessage.reactions.values()) {
      if (reaction.emoji.name === days[day]) {
        const reactedUsers = await reaction.fetchUsers();
        console.log(`${reactedUsers.size} people have responded for today.`);
        if (reactedUsers.size >= 12) {
          const pugAnnounce = discordClient.channels
              .get(module.exports.pugAnnounceChannelId);
          pugAnnounce.send(
              `PUGs are happening today `
            + `(${validDays.get(days[day])}) in 3 hours! `
            + `Please mark your availability over at `
            + `https:\/\/zerowatch-pugs.firebaseapp.com/`);

          // @Mention the people who've responded to the poll.
          let messageText = '';
          for (const user of reactedUsers.values()) {
            if (messageText.length > 0) messageText += ', ';
            messageText += user.toString();
          }
          pugAnnounce.send(messageText);

          console.log('Announced PUGs for today.');
        } else {
          console.log('Not enough people for PUGs today.');
        }
      }
    }
  } else {
    console.log('ERROR: Couldn\'t find current PUG message');
  }
}

/**
 * Handle message reaction add events
 * @param {Discord.MessageReaction} messageReaction The reaction added
 * @param {Discord.User} user The user that added the reaction
 */
async function onMessageReactionAdd(messageReaction, user) {
  if (util.exists(module.exports.prevPugMessage)) {
    messageReactionResponse(messageReaction, user,
        module.exports.prevPugMessage, 'add');
  } else if (util.exists(module.exports.curPugMessage)) {
    messageReactionResponse(messageReaction, user,
        module.exports.curPugMessage, 'add');
  }
}

/**
 * Handle message reaction removal events
 * @param {Discord.MessageReaction} messageReaction The reaction removed
 * @param {Discord.User} user The user that removed the reaction
 */
async function onMessageReactionRemove(messageReaction, user) {
  if (util.exists(module.exports.prevPugMessage)) {
    messageReactionResponse(messageReaction, user,
        module.exports.prevPugMessage, 'remove');
  } else if (util.exists(module.exports.curPugMessage)) {
    messageReactionResponse(messageReaction, user,
        module.exports.curPugMessage, 'remove');
  }
}

/**
 * The functionality for adding and removing reactions is essentially the same.
 * Condense it to this one function and rely on 'mode' to handle the
 * differences.
 * @param {Discord.MessageReaction} messageReaction The reaction added or
 * removed
 * @param {Discord.User} user The user performing the reaction
 * @param {Discord.Message} pugMessage The message the reaction was on
 * @param {string} mode string 'add' or 'remove', depending on the action
 */
async function messageReactionResponse(messageReaction, user, pugMessage,
    mode) {
  if (mode != 'add' && mode != 'remove') return;

  // If we can't find the requested PUG poll for whatever reason, return early.
  if (!util.exists(pugMessage)) return;

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

  // messageReaction.count can be wrong because of caching. We'll just
  // actively fetch the users and get the size from there.
  const reactedUsers = await messageReaction.fetchUsers();
  // When we hit 6 people responding to any specific day on the poll, remove
  // the bot vote.
  if (mode === 'add' && reactedUsers.size >= 6) {
    // TODO(aalberg) There has to be a nicer way to do this.
    for (const user of reactedUsers.values()) {
      if (user.bot) {
        messageReaction.remove(user);
      }
    }
  }

  const curDate = new Date();
  // curDate.getDay() is 0-indexed where 0 = Sunday.
  const days = ['🇺', '🇲', '🇹', '🇼', '🇷', '🇫', '🇸'];
  // Only post these messages between 5PM PST and 8PM PST on the day of
  // the PUGs to minimize spam. 8PM PST is the usual start time for PUGs.
  if (days[curDate.getDay()] === emojiName &&
      17 <= curDate.getHours() && curDate.getHours() <= 19) {
    const pugAnnounce =
        discordClient.channels.get(module.exports.pugAnnounceChannelId);

    // If we hit 12, then that means we incremented from 11.
    // TODO(teejusb): Add functionality to modify PUGs time.
    if (mode === 'add' && reactedUsers.size === 12) {
      pugAnnounce.send(
          `PUGs are happening today `
        + `(${validDays.get(emojiName)}) at 8PM PST! `
        + `Please mark your availability over at `
        + `https:\/\/zerowatch-pugs.firebaseapp.com/`);
    // If we dropped below the threshold then notify users that we've lost
    // quorum for that day.
    // If we hit 11, then that means we decremented from 12.
    } else if (mode === 'remove' && reactedUsers.size === 11) {
      pugAnnounce.send(`We no longer have enough for PUGs `
                     + `on ${validDays.get(emojiName)} :(`);
    }
  }
};

/**
 * Gets the Monday of the current week.
 * @param {Date} date The week to get the Monday of.
 * @return {Date} A Date representing the Monday of the current week with
 * hours, minutes, and seconds set to 0;
 */
function getMonday(date) {
  date = new Date(date);
  const day = date.getDay() || 7;
  if (day !== 1) {
    date.setHours(-24 * (day - 1));
  }
  date.setHours(0);
  date.setMinutes(0);
  date.setSeconds(0);
  return date;
}

module.exports = {
  name: 'pug_poll',
  // The PUG poll channel and announce channel.
  pugPollChannelId: null,
  pugAnnounceChannelId: null,
  // The current and previous PUG poll information.
  prevPugMessage: null,
  curPugMessage: null,

  onMessageReactionAdd,
  onMessageReactionRemove,
  onStart(client, config) {
    discordClient = client;
    module.exports.pugPollChannelId = config.pugPollChannelId;
    module.exports.pugAnnounceChannelId = config.pugAnnounceChannelId;

    const pugPollChannel = client.channels.get(module.exports.pugPollChannelId);
    if (pugPollChannel) {
      console.log(`Found PUG poll channel ${pugPollChannel}`);
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
                module.exports.prevPugMessage = first;
                module.exports.curPugMessage = last;
              } else {
                module.exports.prevPugMessage = last;
                module.exports.curPugMessage = first;
              }
              console.log(`Prev ID is: ${module.exports.prevPugMessage.id}`);
              console.log(`Cur ID is: ${module.exports.curPugMessage.id}`);
            } else if (messages.size === 1) {
              module.exports.curPugMessage = messages.first();
              console.log(`Cur ID is: ${module.exports.curPugMessage.id}`);
            } else {
              console.log('No PUG poll posts found, creating a new one');
              postPoll(new Date());
            }
            console.log(`Found ${messages.size} PUG message(s)!`);
          });
    } else {
      console.log('No PUG poll channel');
    }

    console.log('Attempting to start hour poller');
    hourPoller.start();
  },
  onMessage(message) {
    // TODO(aalberg) This is very brittle. Make this less brittle.
    // (admins accidentally posting in the poll channel explodes things)
    if (message.channel.id === module.exports.pugPollChannelId) {
      // Only the poll should be posted in this channel.
      // If a new poll was posted then reset the PUG poll variables.
      module.exports.prevPugMessage = module.exports.curPugMessage;
      module.exports.curPugMessage = message;
      console.log('New PUG poll was posted.');
      return;
    }
  },
  execute(message, args) {
    // TODO(aalberg) Refactor the permissions module from bnet to util so we
    // can reenable this with actual user validation.
    // return;
    if (args.length > 1) {
      console.log('Too many args');
    } else if (args[0] === 'post') {
      postPoll(new Date());
    } else if (args[0] === 'delete') {
      deletePoll();
    } else if (args[0] === 'announce') {
      announcePug(new Date().getDay());
    }
  },
};
