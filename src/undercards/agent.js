const { SocksProxyAgent } = require('socks-proxy-agent');

module.exports = process.env.UC_PROXY ? new SocksProxyAgent(process.env.UC_PROXY) : undefined;
