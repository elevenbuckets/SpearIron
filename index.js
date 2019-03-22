'use strict';

const WSServ = require('rpc-websockets').Server;
const { promisify } = require('util');
const uuid  = require('uuid/v4');
const rpcport = process.env.rpcport || 3000;
const rpchost = process.env.rpchost || '127.0.0.1';

// Create a server 
const server = new WSServ({
  port: rpcport,
  host: rpchost
});

// fake ACL for testing, should actually comes from extension or CP after user authorization
let allowedApps = [ 'Wallet' ];
let lastKnownId = '';
let dappId = [];

['/'].map((ns) => { return server._generateNamespace(ns) });

server.register('enable', (cfgObj) => 
{
	if ([ ...server.namespaces['/'].clients.keys() ].length > 1) {
		let bad = [ ...server.namespaces['/'].clients.keys() ].filter((x) => { return x !== lastKnownId; });
		return Promise.reject()
                        .catch(() => { bad.map((b) => { disconnect(b) }) })
	} else if ([ ...server.namespaces['/'].clients.keys() ].length === 1) {
		let b = [ ...server.namespaces['/'].clients.keys() ][0];
		lastKnownId = b;
		if (allowedApps.indexOf(cfgObj.appName) !== -1) {
			let nsid = '/' + uuid();
			return switchNameSpace(nsid)(b);
		} else {
			connRateLimit(1500)(b);
			return disconnect(b);
		}
	}
});

const connRateLimit = (t = 1500) => (b) =>
{
	setTimeout(() => { lastKnownId = lastKnownId === b ? '' : lastKnownId; }, t); // allow retry every 1.5 seconds 
}

const disconnect = (b) =>
{
        let s = server.namespaces['/'].clients.get(b);
	s.removeAllListeners('close');
	s.removeAllListeners('message');
        server.namespaces['/'].clients.delete(b);
        Object.keys(server.namespaces['/'].events).map((e) =>
        {
               let index = server.namespaces['/'].events[e].indexOf(b)
               if (index >= 0) server.namespaces['/'].events[e].splice(index, 1)
        })
        s.readyState = 1;
        s._socket.end();
        s._socket.unref();
}

const prepareNameSpace = (nsid) =>
{
	server._generateNamespace(nsid);
	server.register('myMethod', () => { return {'authorized': true}; }, String(nsid));
}

const switchNameSpace = (nsid) => (g) =>
{
	prepareNameSpace(nsid);
	let s = server.namespaces['/'].clients.get(g);
        server.namespaces['/'].clients.delete(g);
	s.removeAllListeners('close');
	s.removeAllListeners('message');

        Object.keys(server.namespaces['/'].events).map((e) =>
        {
               let index = server.namespaces['/'].events[e].indexOf(g)
               if (index >= 0) server.namespaces['/'].events[e].splice(index, 1)
        })

	// redo close event handler
	s.on('close', () => { server.closeNamespace(nsid); })

	server.namespaces[nsid].clients.set(g, s); 
	server._handleRPC(s, nsid); // redo message event handler
	connRateLimit(150)(g);

	return true;
}

// Periodic status report
const servStats = () => 
{
	return setInterval(() => 
	{
		let s = Object.keys(server.namespaces) || [];
		let r = s.length > 0 ? server.namespaces["/"].clients.keys() : [];

		process.stdout.write("\u001b[2J\u001b[0;0H"); // clear current STD;
		console.log(`Entrance Client List:`)
		console.dir(r);
		console.log(`Namespace List:`);
		console.dir(s);
	}, 1000);
}

server.on('listening', servStats);
