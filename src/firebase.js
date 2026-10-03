const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://undercards-chat.firebaseio.com/`,
  storageBucket: `undercards-chat.appspot.com`,
});

if (process.env.DEBUG === 'true') {
  admin.database.enableLogging(true);
}

module.exports = admin;
