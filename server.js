var http = require('http'),
    httpProxy = require('http-proxy'),
    cp = require('child_process'),
    portfinder = require('portfinder'),
    fs = require('fs'),
    findit = require('findit');

var basePort = process.argv[2] || 1337;
portfinder.basePort = basePort;

var nodes = {'dev':{}, 'children':{}};

var proxy = httpProxy.createProxyServer({});

var server = http.createServer(function(req, res) {
               var host = req.headers.host.split('.');
               var subs = host.slice(0, host.length-2);

               var subdomain = undefined;
               var dir       = undefined;

               if (subs.length == 2) {
                 subdomain = subs[1];
                 dir       = 'dev';
                 req.headers.host = host[0] + '.' + (host.slice(2,host.length)).join('.')
               } else if (subs.length < 2) {
                 subdomain = subs[0] || 'helloworld';
                 dir = 'children';
               }

               var path = __dirname + '/' + dir + '/' + subdomain;

               fs.exists(path, function(exists) {
                 if(exists) {
                   if(!(subdomain in nodes[dir])) {
                     portfinder.getPort(function(error, port) {
                       if (!error) {
                         var serverPath = path + '/server.js';
                         console.log(basePort, 'is forking', serverPath, port);
                         var node = cp.fork(serverPath, [port]);
                         findit(path).on('file', function(file, _stat) {
                           fs.watch(file, function(_curr, _prev) {
                             console.log('file in ', path, 'changed,',basePort, 'killing node', port);
                             node.kill('SIGHUP');
                           })
                         })
                         console.log(basePort, 'waiting on message from', serverPath, port);
                         node.on('message', function(msg) {
                           if (msg.msg == 'ready' && msg.sender == port) {
                             console.log(basePort, 'got message from', msg.sender);
                             nodes[dir][subdomain] = {'node': node, 'port':port};
                             if(process.send) process.send({msg: 'ready', sender: port});
                             proxy.web(req, res, { target: 'http://127.0.0.1:' + port });
                           }
                         });
                         node.on('close', function(_signal, _code) {
                           console.log(serverPath,'at', port, 'is dead');
                           delete nodes[dir][subdomain];
                         })
                       }
                     })
                   } else {
                     var port = nodes[dir][subdomain].port;
                     console.log(basePort, 'redirecting to', port);
                     proxy.web(req, res, { target: 'http://127.0.0.1:'+port});
                   }
                 } else {
                   if(nodes[dir][subdomain]) {
                     nodes[dir][subdomain].node.kill('SIGHUP');
                     delete nodes[dir][subdomain];
                   }
                   res.writeHead(200);
                   res.end('No ' + subdomain + ' here!');
                 }
               });
             })

server.listen(portfinder.basePort, function() {
  if(process.send) process.send({msg: 'ready', sender: portfinder.basePort});
});
