var http = require('http'),
    httpProxy = require('http-proxy'),
    cp = require('child_process'),
    portfinder = require('portfinder'),
    fs = require('fs'),
    findit = require('findit'),
    longjohn = require('longjohn');

var basePort = process.argv[2] || 1337;
portfinder.basePort = basePort;

var nodes = {dev:{}, children:{}, checkout:{}};

var proxy = httpProxy.createProxyServer({});

var server = http.createServer(function(req, res) {
               if(req.url == '/favicon.ico') return;

               var host = req.headers.host.split('.');
               var subs = host.slice(0, host.length-2);

               if (subs.length == 3) {
                 if(subs[2] == 'this') {
                   var commitid  = subs[0];
                   var dir       = 'checkout';
                   req.headers.host = subs[1] + '.' + (host.slice(host.length-2,host.length)).join('.');
                   var srcrepo = __dirname + '/children/' + subs[1];
                   checkout(req, res, dir, srcrepo, commitid);
                 } else {
                   var dir      = 'dev';
                   var subdomain = subs[2];
                   req.headers.host = subs[0] + '.' + subs[1] + '.this.' + (host.slice(host.length-2,host.length)).join('.');
                   maybeSpawnAndForward(req, res, dir, subdomain);
                 }
               } else if (subs.length == 2) {
                 var dir       = 'dev';
                 var subdomain = subs[1];
                 req.headers.host = subs[0] + '.' + (host.slice(2,host.length)).join('.');
                 maybeSpawnAndForward(req, res, dir, subdomain);
               } else if (subs.length < 2) {
                 var subdomain = subs[0] || 'helloworld';
                 var dir = 'children';
                 maybeSpawnAndForward(req, res, dir, subdomain);
               }
             })

function checkout(req, res, dir, srcrepo, commitid) {
  cp.exec('cd ' + srcrepo + ' && git rev-parse ' + commitid, function(err, stdout, stderr) {
    if(err) {
      res.writeHead(200);
      res.end('Could not check out ' + commitid + ' from ' + srcrepo + '\n\n' + err);
      return;
    }
    var sha1 = stdout.trim();

    if(!(sha1 in nodes[dir])) {
      nodes[dir][sha1] = {checkingout: true};
      var dest = __dirname + '/checkout/' + sha1;
      var mkdir = 'mkdir -p ' + dest;
      var cd1 = 'cd ' + srcrepo
      var subtree = 'git --work-tree=' + dest + ' checkout -f ' + sha1 + ' -- .';
      var cd2 = 'cd ' + dest
      var init = './init > /dev/null 2>&1';
      var command = '`' + ([mkdir, cd1, subtree, cd2, init].join(' && ')) + '`'
      cp.exec(command, function(err, stdout, stderr) {
        if(err) {
          res.writeHead(200);
          res.end('Could not execute checkout\n\n' + err);
          return;
        }
        console.log('checked ' + sha1 + ' from ' + srcrepo);
        maybeSpawnAndForward(req, res, 'checkout',sha1);
      });
      return;
    } else if (nodes[dir][sha1].checkingout) {
      fs.readFile('./checkingout.html', function (err, d) {
        res.writeHead(200);
        res.write(d);
        res.end();
      })
    } else {
      spawnAndForward(req, res, 'checkout',sha1);
    }
  });
}

function maybeSpawnAndForward(req, res, dir, subdomain) {
  fs.exists(dir + '/' + subdomain, function(exists) {
    if (exists){
      spawnAndForward(req, res, dir, subdomain);
    } else {
      if(nodes[dir][subdomain]) {
        var n = nodes[dir][subdomain].node
        if(n) n.kill('SIGHUP');
        delete nodes[dir][subdomain];
      }
      res.writeHead(200);
      res.end('No ' + __dirname + '/' + dir + '/' + subdomain + ' here!');
    }
  })
}

function spawnAndForward(req, res, dir, subdomain) {
  if(dir == 'checkout' && nodes[dir][subdomain].checkingout) {
    nodes[dir][subdomain].checkingout = false;
    handle(req, res, dir, subdomain);
  } else if (!(subdomain in nodes[dir])) {
    nodes[dir][subdomain] = {};
    handle(req, res, dir, subdomain);
  } else {
    var port = nodes[dir][subdomain].port;
    if(port) {
      console.log(basePort, 'redirecting to', port);
      return proxy.web(req, res, { target: 'http://127.0.0.1:'+port});
    }
  }
}

function handle(req, res, dir, subdomain) {
  var path = dir + '/' + subdomain;
  portfinder.getPort(function(error, port) {
    if (error) {
      delete nodes[dir][subdomain];
      res.writeHead(200);
      res.end('Could not find a free port\n\n' + err);
      return;
    }
    var serverPath = __dirname + '/' + path + '/server.js';
    var node = undefined;
    try {
      console.log(basePort, 'is forking', serverPath, port);
      var node = cp.fork(serverPath, [port]);
    } catch (err) {
      console.log(basePort + ' could not fork ' + serverPath + 'with ' + port);
      res.writeHead(200);
      res.end('Could not start ' + subdomain + ' at ' + serverPath);
      return
    }

    console.log(basePort, 'waiting on message from', serverPath, port);
    node.on('message', function(msg) {
      if (msg.msg == 'ready' && msg.sender == port) {
        nodes[dir][subdomain] = {'node': node, 'port':port};
        console.log(basePort, 'got message from', msg.sender);
        if(process.send) process.send({msg: 'ready', sender: port});
        console.log('watching', serverPath)
        fs.watch(serverPath, function(event,filename) {
          console.log(__dirname, 'killed', serverPath,' in ', path, 'changed,',basePort, 'killing node', port);
          console.log('fs.watch:', event, filename);
          if(node) node.kill('SIGHUP');
        })
        proxy.web(req, res, { target: 'http://127.0.0.1:' + port });
      }
    });
    node.on('close', function(_signal, _code) {
      console.log(serverPath,'at', port, 'is dead');
      delete nodes[dir][subdomain];
    })
  })
}

proxy.on('error', function(e) {
  console.log('http-proxy', e);
})

server.listen(portfinder.basePort, function() {
  if(process.send) process.send({msg: 'ready', sender: portfinder.basePort});
});
