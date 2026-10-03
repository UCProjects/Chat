const { EventEmitter } = require('events');
const WebSocket = require("ws");
const login = require('./login');
const agent = require('./agent');
const parse = require('./parseMessage');
const throttle = require('../util/throttle');

const UNHANDLED_MESSAGE = 'message/unhandled';

const chatNames = ["chat-discussion", "chat-strategy", "chat-beginner", "chat-tournament", "chat-roleplay", "chat-support", "chat-fr", "chat-ru", "chat-es", "chat-pt", "chat-it", "chat-de", "chat-cn", "chat-jp", "chat-tr", "chat-pl"];

class Connection extends EventEmitter {
  constructor(login) {
    super();
    this._login = login;
    this._connected = false;
    this._ws;
    this._pingTimer;
    this._throttle = new throttle({
      throttle: 3250, // One message every 3 seconds
    });

    this.self = {};
    this.friends = [];

    let interval;
    this.on('connect', () => {
      interval = setInterval(() => this.ping(), 9000);
    }).on('disconnect', () => {
      interval && clearInterval(interval);
      this._ws = undefined;
      this.self = {};
      this.friends = [];
    }).on('message/getSelfInfos', (data) => {
      this.self = data.me;
      this.friends = data.friends;
    });
  }

  get connected() {
    return this._connected;
  }

  connect() {
    if (this.connected) return;
    this._connected = true;
    login(this._login).then(({ headers }) => {
      if (!headers['set-cookie']) throw new Error('Login rejected: no session cookie (captcha or bad credentials?)');
      const auth = headers['set-cookie'].map(cookie => cookie.split(";")[0]).join("; ") + ";";

      const ws = this._ws = new WebSocket("wss://undercards.net/chat", { headers: { Cookie: auth }, agent });

      // Wait a bit before timing out
      const timeout = setTimeout(() => {
        this.emit('error/timeout');
        ws.close();
      }, 1000);

      // Getting a message means we've actually connected
      ws.once('message', () => {
        clearTimeout(timeout);
      }).on('open', () => {
        this.emit('connect', this);
      }).on('close', () => {
        this._connected = false;
        this.emit('disconnect', this);
      }).on('error', (e) => {
        this.emit('error'. e, this);
      }).on('message', (data) => {
        this.emit('message/received');

        const parsedData = parse(data);
        const { action } = parsedData;

        const baseEvent = `message/${action}`;
        let emitted = this.emit(baseEvent, parsedData, this);

        if (action === 'getMessageAuto') {
          const { message } = parsedData;
          emitted |= this.emit(`${baseEvent}/${message[0]}`, message, this);
        } else if (action === 'getMessage' || action === 'getPrivateMessage') {
          const room = chatNames[parsedData.idRoom - 1] || parsedData.idRoom;
          parsedData.room = room;
          emitted |= this.emit(`${baseEvent}/${room}`, parsedData, this);
        }

        if (!emitted) {
          this.emit(UNHANDLED_MESSAGE, parsedData, this);
        }
      });
    }).catch((res) => {
      this._connected = false;
      this.emit('error/login', res);
    });
  }

  disconnect() {
    if (this.connected) this._ws.close();
  }

  ping() {
    this._send({
      ping: 'pong',
    });
  }

  message(message, idRoom) {
    this._sendMessage({ message, idRoom });
  }

  privateMessage(message, user) {
    // idUser (UC internal), userid (bot internal), raw (just to support it)
    const idFriend = user.idUser || user.id || user.userid || user;
    this._sendMessage({ message, idFriend });
  }

  _sendMessage({ message = '', idRoom = '-1', idFriend = '0' }) {
    if (!message || (idRoom === '-1' && idFriend === '0')) return;
    this._throttledMessage({
      action: 'message',
      message,
      idRoom: `${idRoom}`,
      idFriend: `${idFriend}`,
    });
  }

  _throttledMessage(data) {
    this._throttle.queue(() => this._send(data));
  }

  _send(data) {
    if (typeof data !== 'string') {
      data = JSON.stringify(data);
    }

    this._ws.send(data);
  }
}

module.exports = Connection;
module.exports.UNHANDLED_MESSAGE = UNHANDLED_MESSAGE;
