const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const host = '127.0.0.1';
const rootDir = __dirname;
const historyApiHost = process.env.HISTORY_API_HOST || '127.0.0.1';
const historyApiPort = Number(process.env.HISTORY_API_PORT || 8010);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function safeResolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const cleaned = decoded.replace(/^\/+/, '');
  const requested = cleaned === '' ? 'index.html' : cleaned;
  const absolute = path.resolve(rootDir, requested);

  if (!absolute.startsWith(path.resolve(rootDir))) {
    return null;
  }

  return absolute;
}

function proxyHistoryApi(req, res) {
  const incomingUrl = new URL(req.url || '/', `http://${host}`);
  const options = {
    hostname: historyApiHost,
    port: historyApiPort,
    path: incomingUrl.pathname + incomingUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${historyApiHost}:${historyApiPort}`
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: 'History API proxy failed',
      target: `http://${historyApiHost}:${historyApiPort}`,
      message: err.message
    }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/history')) {
    proxyHistoryApi(req, res);
    return;
  }

  const filePath = safeResolvePath(req.url || '/');

  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(0, host, () => {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  console.log(`Frontend running at http://${host}:${port}`);
  console.log(`History API proxy target: http://${historyApiHost}:${historyApiPort}`);
});

server.on('error', (err) => {
  console.error('Failed to start frontend server:', err.message);
  process.exit(1);
});