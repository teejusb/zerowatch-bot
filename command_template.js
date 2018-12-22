module.exports = {
  name: 'somecommand', // Called via !somecommand
  description: 'description of command',
  aliases: ['commandalias'], // Also callable via !commandalias
  usage: '[command name]',
  cooldown: 3, // Cooldown in seconds. If unspecified, defaults to 3 seconds.
  args: true, // Whether or not this command requires arguments.
  execute(message, args) {
    // Function body to process command
  },
};