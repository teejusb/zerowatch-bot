module.exports = {
  name: 'roll',
  cooldown: 5,
  description: 'Roll an n-sided dice.',
  args: true,
  usage: '[number]',
  execute(message, args) {
    const min = 1;
    const max = parseInt(args[0]);

    if (isNaN(max)) {
      return message.reply('That doesn\'t seem to be a valid number.');
    }

    if (max <= min) {
      return message.reply('You must specify a number greater than 1.');
    }

    const rolled = Math.floor(Math.random() * (max - min + 1)) + min;

    message.channel.send(`${message.author.username} rolled a ${rolled}.`);
  },
};