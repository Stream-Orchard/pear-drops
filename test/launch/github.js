// A stand-in GitHub for update tests: a local server answering the release API and
// serving a zip of a made-up newer version. Also a tiny zip writer for the unit tests.
const http = require('http');
const zlib = require('zlib');

/** entries: [name, content, deflate?] -> a .zip Buffer (stored or deflated). */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content ?? '');
    const isDir = name.endsWith('/');
    const body = isDir ? Buffer.alloc(0) : deflate ? zlib.deflateRawSync(data) : data;
    const method = !isDir && deflate ? 8 : 0;
    const crc = zlib.crc32 ? zlib.crc32(data) : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(isDir ? 0 : data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(isDir ? 0 : data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, body);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * Starts the stand-in: GET /repos/<repo>/releases/latest answers `release` (with the zip's
 * address filled in), GET /zip serves `zip`. Names in `moved` are the repository's old ones:
 * like GitHub after a rename, they answer 301 to /repositories/<id>/... -> { url, close, hits }
 */
function standInGitHub({ repo, release, zip, moved = [] }) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const base = `http://127.0.0.1:${server.address().port}`;
    const old = moved.find((m) => req.url.startsWith(`/repos/${m}/`));
    if (old) {
      res.writeHead(301, { location: `${base}/repositories/1/${req.url.slice(`/repos/${old}/`.length)}` });
      return res.end();
    }
    if (req.url === `/repos/${repo}/releases/latest` || req.url === '/repositories/1/releases/latest') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ zipball_url: `${base}/zip`, ...release }));
    }
    if (req.url === '/zip' && zip) {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zip.length });
      return res.end(zip);
    }
    res.writeHead(404);
    res.end('{}');
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) })),
  );
}

module.exports = { makeZip, standInGitHub };
