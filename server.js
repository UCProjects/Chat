//glitch stuff
const express = require("express");
const app = express();
app.use(express.static("public"));
app.get("/", (request, response) => {
  response.send("oof");
});
const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});

//real stuff
const https = require("https");
const agent = https.globalAgent;
const WebSocket = require("ws");

//sign in once
/**/
reqHttps("undercards.net/SignIn", process.env.LOGINBODY, headers => {
  let setCookie = headers["set-cookie"];
  let auth = setCookie.map(cookie => cookie.split(";")[0]).join("; ") + ";";
  console.log(auth);

  //ws stuff with auth
  const hostname = "undercards.net/chat";
  const options = {
    headers: {
      Cookie: auth,
      Host: hostname,
      Origin: "https://" + hostname,
      Referer: "https://" + hostname,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36"
    }
  };
  const ws = new WebSocket("wss://undercards.net/chat", options);
  //ws stuff
  ws.on("open", function open() {
    /*ws.send(
      JSON.stringify({
        action: "openRoom",
        room: "chat-discussion"
      })
    );

    setInterval(() => {
      ws.send(
        JSON.stringify({
          ping: "pong"
        })
      );
      console.log("pinged");
    }, 9000);*/
  });

  ws.on("message", function incoming(data) {
    console.log(data);
  });
});
//*/

//boilerplate https post request, better to have fine control than a library
//do NOT put https:// part of url, it expects everything after that
function reqHttps(url, body, callback) {
  const hostname = url.split("/")[0];
  const options = {
    hostname: hostname,
    port: 443,
    path: encodeURI(url.slice(url.indexOf("/"))),
    method: "POST",
    headers: {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
      Connection: "keep-alive",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Content-Length": body ? body.length : 0,
      //Cookie: cookie,
      Host: hostname,
      Origin: "https://" + hostname,
      Referer: "https://" + hostname,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36"
    }
  };
  const req = https.request(options, res => {
    //console.log("statusCode:", res.statusCode);
    //console.log("headers:", res.headers);
    callback(res.headers);
    /*let total = "";
    res.on("data", d => {
      total += d;
    });
    res.on("end", () => {
      callback ? callback(total) : null;
    });*/
  });
  req.on("error", console.error.bind(console));
  if (body) req.write(body);
  req.end();
}
