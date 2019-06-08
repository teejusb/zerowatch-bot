const util = require('../util/util.js');
const { WebClient } = require('@slack/web-api');

let slackClient = null;
let slackChannel = null;

/**
 * Posts a message to the annoucements channel in slack.
 * @param {string} text The text string to post.
 */
async function postMessage(text) {
  if (!util.exists(slackClient) || !util.exists(slackChannel)) { return; }
  await slackClient.chat.postMessage({
    channel: slackChannel,
    text: text,
  });
}

module.exports = {
  postMessage,
  name: 'slack',
  onStart(client, config, private_config) {
    slackChannel = config.slack.channel;
    slackClient = new WebClient(private_config.slackToken);
    slackClient.api.test();
  },
  execute(message, args) {
    // TODO(aalberg): Add authentication and reenable.
    return;
    if (args.length != 2) {
      message.channel.send('Wrong number of args');
    } else if (args[0] == "post") {
      postMessage(args[1]);
    } else {
      message.channel.send('Invalid subcommand');
    }
  },
};
