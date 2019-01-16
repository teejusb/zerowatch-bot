module.exports = {
  name: 'bnet',
  cooldown: 5,
  description: 'Battletag management',
  on_start() {
    console.log(`Starting ${name}`);
  },
  execute(message, args) {
    if (!args.length) {
      message.channel.send('Pong.');
    } else {
      message.channel.send('Pong: ' + args);
    }
  },
};
