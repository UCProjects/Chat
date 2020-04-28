const Entities = require('html-entities').AllHtmlEntities;
const parseMessageEmotes = require('./parseEmotes');

const entities = new Entities();
const specialCharacters = /([`|*~]|^>)/g;
const emoteRegex = /:[^\s:]+(?:\\_[^\s_:]+)+:/g;

function getMessage({ user, message, me }) {
  let safeMessage = entities.decode(parseMessageEmotes(message.replace(/_/g, '\\_'))) // Scrub underscores
    .replace(emoteRegex, (match) => match.replace(/\\/g, '')) // Allow default emoji, because it's cute
    .replace(specialCharacters, '\\$1'); // Scrub discord characters
  if (me) {
    safeMessage = `*${safeMessage}*`;
  }
  return {
    message: safeMessage,
    username: entities.decode(user.username),
  };
}

module.exports = getMessage;