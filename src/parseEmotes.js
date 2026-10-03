const emoji = require('./discordEmoji');
const stats = require('./stats');

const emoteRegex = /<img\b[^>]*?\bsrc="images\/emotes\/([^"]*)"[^>]*>/g;

const popular = stats.counters('emoji');
const missing = stats.counters('emojiMissing');
const missingGif = stats.counters('emojiMissingAnimated');

function parseMessageEmotes(message = '') {
  const previous = new Set(); // Limit one of each emoji per message

  const parsedMessage = message.replace(emoteRegex, (_, $1) => {
    const emote = $1.replace(/\\/g, '');
    
    const incremented = previous.has(emote);
    if (!incremented) {
      popular.get(emote).increment();
      previous.add(emote);
    }

    const discord = emoji[emote];
    if (discord) return discord;

    if (!incremented) {
      const counter = emote.endsWith('.gif') ? missingGif : missing;
      counter.get(emote).increment();
    }

    return `:${emote.substring(0, emote.lastIndexOf('.'))}:`;
  });
  // console.log(parsedMessage);
  return parsedMessage;
}

module.exports = parseMessageEmotes;
