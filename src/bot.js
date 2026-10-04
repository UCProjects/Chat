const axios = require('axios');
const Eris = require('eris');
const chatRecord = require('./util/chat-record');
const EMOJI = require('./discordEmoji');
const { prepareEmoteImage } = require('./emoteImage');
const { endpoints, autoTemplates } = require('./endpoints');
const firebase = require('./firebase');
const getMessage = require('./getMessage');
const Limiter = require('./util/cooldown');
const ranks = require('./undercardsRanks');
const stats = require('./stats');
const Undercards = require('./undercards/connection');
const databaseValue = require('./util/database-value');
const pipe = require('./util/pipe');
const pipeIf = require('./util/pipe-if');

let sendStatus;
const templateRegex = /\$(\d+)/g;
const reportLimits = new Limiter({
  cooldown: 60000, // 1 minute per user
  globalCooldown: 30000, // 30 seconds between users
});
const reconnection = {
  delay: 0,
  timeout: null,
  attempts: 0,
  maxNotified: false,
  stableTimeout: null,
  maxDelay: 60 * 60 * 1000,
  stableAfter: 30000,
};
const _INFO_ = {
  chan: process.env.CHANNEL_INFO,
};
const _MUTE_ = {
  chan: process.env.CHANNEL_MUTED,
};
const emojiURI = 'https://undercards.net/images/emotes/';
const alertRole =process.env.ALERT_ROLE;

const _REPORTS_ = databaseValue('config/undercards/endpoints/reports');

const undercards = new Undercards(process.env.LOGINBODY);
const discord = new Eris.CommandClient(process.env.DISCORD_BOT_TOKEN, {
  intents: ['allNonPrivileged', 'messageContent'],
}, {
  prefix: ['@mention', '~'],
});

const commandRequirements = {
  userIDs: [
    '208562116590960640', // feildmaster
  ],
  roleIDs: [
    '703677962859315230', // Manager
  ],
};

discord.on('error', (err) => console.log(err.code ? `Error: ${err.code}${err.message?`: ${err.message}`:''}` : err));

const emojiGuilds = [
  '797805263658418196', // emote server
  '703480379545354261', // main server
];
const emojiMimeTypes = {
  png: 'image/png',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
const emojiLimitCodes = [30008, 30018];
const emojiMaxBytes = 256 * 1024;

function emoteKey(input = '') {
  return input.split(/[?#]/)[0].split('/').pop();
}

function emojiName(key, override) {
  const base = override || key.substring(0, key.lastIndexOf('.'));
  return base.replace(/[^\w]/g, '_').padEnd(2, '_').substring(0, 32);
}

function registerEmoji(key, { id, name, animated }) {
  return firebase.database().ref(`config/undercards/emoji/${key.replace('.', '_')}`).set({
    id,
    name,
    animated: !!animated,
  });
}

async function uploadEmoji(key, override) {
  const extension = key.substring(key.lastIndexOf('.') + 1).toLowerCase();
  const mime = emojiMimeTypes[extension];
  if (!mime) throw new Error(`Unsupported extension \`${extension}\``);

  const { data } = await axios.get(`${emojiURI}${encodeURIComponent(key)}`, { responseType: 'arraybuffer' });
  const prepared = prepareEmoteImage(Buffer.from(data), mime);
  if (prepared.buffer.length > emojiMaxBytes) {
    throw new Error(`Image is ${Math.round(prepared.buffer.length / 1024)} KB, over Discord's ${emojiMaxBytes / 1024} KB limit`);
  }
  const image = `data:${prepared.mime};base64,${prepared.buffer.toString('base64')}`;
  const name = emojiName(key, override);

  const skipped = [];
  for (const guildID of emojiGuilds) {
    if (!discord.guilds.has(guildID)) {
      skipped.push(`${guildID} (bot is not in this guild)`);
      continue;
    }
    try {
      return await discord.createGuildEmoji(guildID, { name, image }, `Registered for ${key}`);
    } catch (err) {
      if (!emojiLimitCodes.includes(err.code)) throw err;
      skipped.push(`${guildID} (no emoji slots left)`);
    }
  }
  throw new Error(`No guild could take the emoji: ${skipped.join(', ')}`);
}

const pending = new Map();
const emotes = discord.registerCommand('emotes', (msg, args) => {
  const run = !!args.length;
  const tempKey = args[0] || '';
  const url = tempKey.lastIndexOf('/') + 1;
  const key = url ? tempKey.substring(url) : tempKey;

  if (run && key.lastIndexOf('.') === -1) return 'Missing emote extension';

  if (run) {
    const existing = EMOJI[key];
    if (existing) {
      return `\`${key}\` registered to ${existing}`;
    }
  }

  const emoji = [];
  discord.guilds.forEach(({emojis}) => emoji.push(...emojis.filter(({id}) => !EMOJI[id])));

  const safeEmoji = emoji.slice(0, 20);

  if (!safeEmoji.length) return 'Found no emoji';

  return discord.createMessage(msg.channel.id, run ? `Select emoji for \`${key}\`` : 'Unused Emoji').then((resp) => {
    safeEmoji.forEach(({id, name}) => resp.addReaction(`${name?`${name}:`:''}${id}`));

    if (run) {
      pending.set(resp.id, {
        key,
        emoji: safeEmoji,
        uid: msg.author.id,
      });
    }
  });
}, {
  requirements: commandRequirements,
});

async function addEmote(input, name) {
  const key = emoteKey(input);
  if (key.lastIndexOf('.') === -1) return 'Missing emote extension';

  const existing = EMOJI[key];
  if (existing) return `\`${key}\` registered to ${existing}`;

  try {
    const emoji = await uploadEmoji(key, name);
    await registerEmoji(key, emoji);
    return `Registered <${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}> for \`${key}\``;
  } catch (err) {
    console.error(err);
    return `Failed to add \`${key}\`: ${err.message}`;
  }
}

emotes.registerSubcommand('add', (msg, args) => {
  if (!args.length) return 'Usage: `~emotes add <key or url> [name]`';
  return addEmote(args[0], args[1]);
}, {
  requirements: commandRequirements,
  description: 'Upload an undercards emote to Discord and register it',
  usage: '<key or url> [name]',
});

const candidatePrefix = 'emote:';

function isAuthorized(member) {
  return !!member && (
    commandRequirements.userIDs.includes(member.id)
    || member.roles.some((id) => commandRequirements.roleIDs.includes(id))
  );
}

discord.on('interactionCreate', async (interaction) => {
  if (!(interaction instanceof Eris.ComponentInteraction)) return;
  const id = interaction.data.custom_id || '';
  if (!id.startsWith(candidatePrefix)) return;

  try {
    if (!isAuthorized(interaction.member)) {
      return await interaction.createMessage({ content: 'Not allowed', flags: Eris.Constants.MessageFlags.EPHEMERAL });
    }
    await interaction.defer();
    await interaction.editOriginalMessage(await addEmote(id.substring(candidatePrefix.length)));
  } catch (err) {
    console.error(err);
  }
});

discord.on('messageReactionAdd', (msg, emoji, reactor) => {
  const uid = reactor.id;
  if (discord.user.id === uid) return; // Ignore self
  const data = pending.get(msg.id);
  if (!data) return;
  if (data.uid !== uid) return console.log(`UID(${uid}) incorrect`);
  if (!data.emoji.some(({id}) => id === emoji.id)) return console.log(`${emoji.id} not found`);
  pending.delete(msg.id);

  msg.removeReactions(); // Remove reactions immediately
  registerEmoji(data.key, emoji).then(() =>
    msg.edit(`Registered <${emoji.animated?'a':''}:${emoji.name}:${emoji.id}> for \`${data.key}\``)
  ).catch(console.error);
});

discord.registerCommand('restart', (msg, args) => {
  return getSendStatus()({
    shuttingDown: true,
    message: 'Restarting',
  }).then(() => discord.createMessage(msg.channel.id, 'Restarting!')
  .catch(console.error)
  .then(() => process.exit()));
}, {
  requirements: commandRequirements,
});

discord.registerCommand('status', (msg) => {
  return getSendStatus()({
    endpoint: {
      chan: msg.channel.id,
    },
    extended: false,
  }).then(() => {
    // noop
  });
}, {
  cooldown: 60*1000,
});

function getSendStatus() {
  if (!sendStatus) {
    sendStatus = require('./status');
  }
  return sendStatus;
}

function backoff(base) {
  const delay = Math.min(base * 2 ** reconnection.attempts, reconnection.maxDelay);
  reconnection.attempts++;
  return delay;
}

function reconnectUC(delay = 0) {
  if (undercards.connected) return;
  const now = Date.now();
  if (reconnection.timeout) {
    if (reconnection.delay > delay + now) {
      clearTimeout(reconnection.timeout);
    } else return;
  }

  reconnection.delay = now + delay;
  reconnection.timeout = setTimeout(() => {
    reconnection.timeout = null;
    undercards.connect();
  }, delay);
}

function post(endpoint, data) {
  const outgoing = stats.counters('messages').get('outgoing');
  if (endpoint.chan) {
    const clone = { ...data };
    return discord.createMessage(endpoint.chan, clone)
    .then(pipe(() => {
      outgoing.increment();
    }))
    .catch(console.error);
  }

  return Promise.resolve(false);
}

function cleanString(string) {
  return string.replace(/_/g, '\\_').replace(getMessage.specialCharacters, '\\$1');
}

// TODO: Modularize message handlers
undercards.on('connect', () => { // Join rooms
  clearTimeout(reconnection.stableTimeout);
  reconnection.stableTimeout = setTimeout(() => {
    reconnection.attempts = 0;
    reconnection.maxNotified = false;
  }, reconnection.stableAfter);

  getSendStatus()();

  discord.editStatus('online');
}).on('message/getHistory', ({room = '', history = []} = {}) => {
  history.forEach(message => chatRecord.add(message, room));
}).on('message/received', () => { // Increment incoming stats
  stats.counters('messages').get('incoming').increment();
}).on('message/deleteMessages', (data) => {
  const entries = new Map();
  let muteMessage;

  chatRecord.find(data.idUser).forEach((r) => {
    const key = `${r.room}_${r.userid}`;
    if (entries.has(key)) return;
    const endpoint = endpoints[r.room];
    const message = {
      content: `${cleanString(getMessage.decode(r.username))}#${r.userid} was muted`,
    }

    // Mute channel
    if (_MUTE_.chan) {
      muteMessage = {
        endpoint: _MUTE_,
        message: { ...message },
      };
      entries.set(`muted_${r.userid}`, muteMessage);
    }

    entries.set(key, {
      endpoint,
      message,
    });
  });

  if (muteMessage) {
    muteMessage.message.content += ` (${[...entries.keys()]
      .filter((key = '') => !key.startsWith('muted_'))
      .map((key = '') => key.substring(0, key.lastIndexOf('_')))
      .join(', ')})`;
  }

  for (const { endpoint, message } of entries.values()) {
    post(endpoint, message);
  }
}).on('disconnect', () => {
  clearTimeout(reconnection.stableTimeout);
  getSendStatus()({
    message: 'Socket Closed',
  });
  console.debug('Socket Closed');
  // We can technically try and reconnect here
  if (process.exitCode === undefined) {
    discord.editStatus('idle');
    reconnectUC(backoff(500));
  }
}).on('error', (err) => {
  console.error('Connection error:', err);
}).on('error/login', (res) => {
  const reason = res && (res.statusCode || res.message) || res;
  console.error('Server unavailable:', reason);
  // TODO: Add restart flag
  const first = reconnection.attempts === 0;
  const delay = backoff(5000);
  const maxed = delay >= reconnection.maxDelay && !reconnection.maxNotified;
  console.error(`Retrying in ${Math.round(delay / 1000)}s`);
  reconnectUC(delay);
  discord.editStatus('idle');

  if (maxed) {
    reconnection.maxNotified = true;
    getSendStatus()({
      message: `Still unable to log in (${reason}). Backoff has reached its maximum, retrying every ${Math.round(delay / 60000)} minutes.`,
      extended: false,
    });
  } else if (first) {
    getSendStatus()({
      message: `Unable to log in (${reason}). Retrying with increasing delays.`,
      extended: false,
    });
  }
}).on('error/timeout', () => {
  console.error('Timeout occurred: Please check login credentials');
  discord.editStatus('idle');
  getSendStatus()({
    message: 'Timeout occurred: please check login credentials.',
    extended: false,
  });
}).on('message/getPrivateMessage', (data) => { // TODO: Handle private messages
  console.log('[PM]', JSON.stringify(data));
});

if (_INFO_.chan) {
  undercards.on('message/getMessageBroadcast', ({ message }) => {
    // TODO: Parse message for images
    post(_INFO_, {
      content: message,
    });
  });
}

// Chat rooms
Object.entries(endpoints)
.filter(([ _, { chan } = {} ]) => chan)
.forEach(([ room, { chan } ]) => {
  undercards.on(`message/getMessage/${room}`, ({ chatMessage }) => {
    chatRecord.add(chatMessage, room);
    if (!chan) return;
    const user = chatMessage.user;
    const { message, username } = getMessage(chatMessage);
    const data = {
      embed: {
        author: {
          name: username,
          icon_url: 'https://undercards.net/images/avatars/' + user.avatar.image + '.' + (user.avatar.extension || 'png')
        },
        description: message,
        color: ranks[user.mainGroup.name] || ranks.User,
        footer: {
          text: `ID:${user.id}, LV:${user.level}(${user.division.replace('_', ' ')})`,
        },
      },
    };

    const alert = alertRole && isReport(message) && reportLimits.check(user.id) === true;
    if (alert) {
      data.content = alertRole;
    }

    const _reports = _REPORTS_.value();
    post({ chan }, data)
      .then(pipeIf(_reports && alert, (res) => {
        if (res instanceof Eris.Message) { // Link to original message
          data.content = `https://discord.com/channels/${res.guildID}/${res.channel.id}/${res.id}`;
          return post(_reports, data);
        }
      }));
  });
});
// Auto messages
Object.entries(autoTemplates)
.filter(([ _, { chan } = {} ]) => chan)
.forEach(([ type, { chan, template } ]) => {
  undercards.on(`message/getMessageAuto/${type}`, (message) => {
    post({ chan }, {
      content: template.replace(templateRegex, (m, key) => message.hasOwnProperty(key) ? cleanString(message[key]) : ""),
    });
  });
});

// DEBUG
if (process.env.DEBUG === 'true') {
  function getData(data) {
    switch (data.action) {
      case '':
      case 'getMessage': return '';
      default: return JSON.stringify(data);
    }
  }

  undercards.on('message/unhandled', (data) => { // Debug unhandled messages
    console.debug(`[UNHANDLED] ${data.action}:`, getData(data));
  });
}

discord.connect().then(() => undercards.connect());

process.on('exit', () => {
  undercards.disconnect();
  discord.editStatus('invisible');
  // discord.disconnect({ reconnect: false });
});

function isReport(message) {
  const lower = message.toLowerCase().split(' ')[0];
  return lower === '@report';
}

module.exports = {
  undercards,
  discord,
  connected: () => {
    return undercards.connected;
  },
  post,
};
