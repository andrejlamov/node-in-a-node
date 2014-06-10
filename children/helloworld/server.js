var http = require('http'),
    static = require('node-static');

var fileServer = new static.Server(__dirname + '/www');
var port = process.argv[2];

http.createServer(function(req, resp) {
  fileServer.serve(req, resp, function(err, res) {
    if(err) {
      console.log(__dirname, port, 'throwing error', req.url,  err.message);
      resp.writeHead(err.status, err.headers);
      resp.end();
      return;
    }
  });
}).listen(port, function(){
  if(process.send) process.send({msg: 'ready', 'sender': port});
})