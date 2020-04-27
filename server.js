//glitch stuff
require('./src/glitch');

//real stuff
const WebSocket = require("ws");
const { endpoints, autoTemplates } = require('./src/endpoints');
const ranks = require('./src/ranks');
const reqHttps = require('./src/https');
const getMessage = require('./src/getMessage');

const templateRegex = /\$(\d+)/g;

//sign in once
reqHttps("undercards.net/SignIn", process.env.LOGINBODY, "application/x-www-form-urlencoded; charset=UTF-8", headers => {
  const setCookie = headers["set-cookie"];
  const auth = setCookie.map(cookie => cookie.split(";")[0]).join("; ") + ";";
  //console.log(auth);

  //ws stuff with auth
  const hostname = "undercards.net/chat";
  const options = {
    headers: {
      Cookie: auth,
    }
  };
  const ws = new WebSocket("wss://undercards.net/chat", options);
  //ws stuff
  ws.on("open", function open() {
    // Join rooms we care about
    Object.keys(endpoints).forEach((room) => {
      if (!endpoints[room].hook) return;
      ws.send(JSON.stringify({
        room,
        action: "openRoom",
      }));
    });

    setInterval(() => {
      ws.send(JSON.stringify({
        ping: "pong"
      }));
    }, 9000);
  });
  
  //if the server goes down restart the app for new auth
  ws.on("close", function socketClosed() {
    console.log('Websocket disconnected');
    process.exit();
  });

  ws.on("message", function incoming(data) {
    const output = {
      hook: null,
      json: null,
    };
    
    const parsedData = JSON.parse(data);
    // console.log(parsedData)
    if (parsedData.action === 'getMessage') {
      const room = parsedData.room;
      const endpoint = endpoints[room] || {};
      if (!endpoint.hook) return; // This is just a fail-safe
      const chatMessage = JSON.parse(parsedData.chatMessage);
      //let id = chatMessage.id;
      const user = chatMessage.user;
      //decode html entities sent over and fit to discord
      const { message, username } = getMessage(chatMessage);
      //console.log(id, user.username, message);
      output.hook = endpoint.hook;
      output.json = {
        username: `${endpoint.title || room} webhook`,
        avatar_url: 'https://undercards.net/images/souls/DETERMINATION.png',
        //content: message,
        embeds: [
          {
            author: {
              name: username,
              icon_url: 'https://undercards.net/images/avatars/' + user.avatar.image + '.' + user.avatar.extension
            },
            description: message,
            color: parseInt(ranks[user.mainGroup.priority] || ranks[10], 16),
            footer: {
              text: user.id,
            },
          }
        ]
      };
    } else if (parsedData.action === 'getMessageBroadcast') {
      const endpoint = process.env.WEBHOOK_INFO;
      if (!endpoint) return;
      output.hook = endpoint;
      output.json = {
        username: 'info-chan',
        avatar_url: 'https://undercards.net/images/souls/DETERMINATION.png',
        content: parsedData.message,
      };
    } else if (parsedData.action === 'getMessageAuto') {
      const message = JSON.parse(JSON.parse(parsedData.message).args);
      const endpoint = autoTemplates[message[0]];
      if (!endpoint || !endpoint.hook) return;
      output.hook = endpoint.hook;
      output.json = {
        username: `${endpoint.title} webhook`,
        avatar_url: 'https://undercards.net/images/souls/DETERMINATION.png',
        content: endpoint.template.replace(templateRegex, (m, key) => message.hasOwnProperty(key) ? message[key] : ""),
      };
    }
    
    if (output.hook && output.json) {
      reqHttps(output.hook, JSON.stringify(output.json), "application/json; charset=UTF-8");
    }
  });
});
