var http = require('http'),
    httpProxy = require('http-proxy'),
    cp = require('child_process'),
    portfinder = require('portfinder'),
    fs = require('fs'),
    findit = require('findit');

var basePort = process.argv[2] || 1337;
portfinder.basePort = basePort;

var nodes = {dev:{}, children:{}, checkout:{}};

var proxy = httpProxy.createProxyServer({});

var server = http.createServer(function(req, res) {

               var host = req.headers.host.split('.');
               var subs = host.slice(0, host.length-2);

               if (subs.length == 3) {
                 if(subs[2] == 'this') {
                   var commitid  = subs[0];
                   var dir       = 'checkout';
                   var subdomain = subs[0];
                   req.headers.host = subs[1] + '.' + (host.slice(host.length-2,host.length)).join('.');
                   var srcrepo = __dirname + '/children/' + subs[1];
                   cp.exec('cd ' + srcrepo + ' && git rev-parse ' + commitid, function(err, stdout, stderr) {
                     if(err) {
                       res.writeHead(200);
                       res.end('Could not check out ' + commitid + ' from ' + srcrepo + '\n\n' + err);
                       return;
                     }

                     var sha1 = stdout.trim();
                     var dest = __dirname + '/checkout/' + sha1;
                     var mkdir = 'mkdir -p ' + dest
                     var cd1 = 'cd ' + srcrepo
                     var subtree = 'git --work-tree=' + dest + ' checkout ' + sha1 + ' -- .';
                     var cd2 = 'cd ' + dest
                     var init = './init > /dev/null 2>&1';
                     var command = '`' + ([mkdir, cd1, subtree, cd2, init].join(' && ')) + '`'

                     cp.exec(command, function(err, stdout, stderr) {
                       if(err) {
                         res.writeHead(200);
                         res.end('Could not execute checkout\n\n' + err);
                         return;
                       }
                       maybeSpawnAndProxy('checkout',sha1, false);
                     });
                   });
                 } else {
                   var dir      = 'dev';
                   var subdomain = subs[2];
                   req.headers.host = subs[0] + '.' + subs[1] + '.this.' + (host.slice(host.length-2,host.length)).join('.');
                   maybeSpawnAndProxy(dir, subdomain, true);
                 }
               } else if (subs.length == 2) {
                 var dir       = 'dev';
                 var subdomain = subs[1];
                 req.headers.host = subs[0] + '.' + (host.slice(2,host.length)).join('.');
                 maybeSpawnAndProxy(dir, subdomain, true);
               } else if (subs.length < 2) {
                 var subdomain = subs[0] || 'helloworld';
                 var dir = 'children';
                 maybeSpawnAndProxy(dir, subdomain, true);
               }

               function maybeSpawnAndProxy(dir, subdomain, watch) {
                 fs.exists(dir + '/' + subdomain, function(exists) {
                   if (exists){
                     spawnAndProxy(dir, subdomain, watch);
                   } else {
                     if(nodes[dir][subdomain]) {
                       nodes[dir][subdomain].node.kill('SIGHUP');
                       delete nodes[dir][subdomain];
                     }
                     res.writeHead(200);
                     res.end('No ' + subdomain + ' here!');
                   }
                 })
               }

               function spawnAndProxy(dir, subdomain, watch) {
                 var path = dir + '/' + subdomain;
                 if(!(subdomain in nodes[dir])) {
                   portfinder.getPort(function(error, port) {
                     if (!error) {
                       var serverPath = path + '/server.js';
                       console.log(basePort, 'is forking', serverPath, port);
                       var node = cp.fork(serverPath, [port]);
                       if(watch) {
                         findit(path).on('file', function(file, _stat) {
                           console.log('watching', file)
                           fs.watch(file, function(_curr, _prev) {
                             console.log(file,' in ', path, 'changed,',basePort, 'killing node', port);
                             if(node) node.kill('SIGHUP');
                           })
                         })
                       }
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
               }
             })

server.listen(portfinder.basePort, function() {
  if(process.send) process.send({msg: 'ready', sender: portfinder.basePort});
});
