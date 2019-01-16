module.exports = {
  name: 'ping',
  cooldown: 5,
  description: 'Ping!',
  execute(message, args) {
    if (!args.length) {
      message.channel.send('Pong.');
    } else {
      message.channel.send('Pong: ' + args);
    }
  },
};
