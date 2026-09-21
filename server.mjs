import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { extname, join, normalize } from 'node:path';
import { Readable, Transform } from 'node:stream';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4173);
const root = join(process.cwd(), 'dist');
const secret = randomBytes(32);
const maxBytes = 500 * 1024 * 1024;
const maxConcurrentDownloads = 3;
const allowedExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
const staticTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
let activeDownloads = 0;

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function isPrivateAddress(address) {
  const value = address.toLowerCase();
  if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped || (/^\d+\.\d+\.\d+\.\d+$/.test(value) ? value : null);
  if (!ipv4) return false;
  const parts = ipv4.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224;
}

async function validateUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid web address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links are supported.');
  if (url.username || url.password) throw new Error('Links containing credentials are not supported.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Only standard web ports are supported.');
  const hostName = url.hostname.replace(/^\[|\]$/g, '');
  if (hostName === 'localhost' || hostName.endsWith('.local')) throw new Error('Local network links are not allowed.');
  const addresses = await lookup(hostName, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('Private network links are not allowed.');
  return url;
}

async function fetchChecked(input, method = 'HEAD') {
  let url = await validateUrl(input);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let result;
    try {
      result = await fetch(url, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: method === 'GET' ? { 'User-Agent': 'Drift/1.0' } : { 'User-Agent': 'Drift/1.0', Range: 'bytes=0-0' }
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.get('location');
      if (!location || redirects === 3) throw new Error('The source redirected too many times.');
      url = await validateUrl(new URL(location, url).href);
      continue;
    }
    return { result, finalUrl: url };
  }
  throw new Error('Could not reach the media source.');
}

function safeFilename(url, contentType) {
  let name = decodeURIComponent(url.pathname.split('/').pop() || 'media-file');
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 120);
  if (!extname(name)) {
    const extension = contentType.includes('audio/') ? '.mp3' : '.mp4';
    name += extension;
  }
  return name || 'media-file';
}

function encodeToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function decodeToken(token) {
  const [data, signature] = String(token || '').split('.');
  if (!data || !signature) throw new Error('Invalid download link.');
  const expected = createHmac('sha256', secret).update(data).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('Invalid download link.');
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (payload.expires < Date.now()) throw new Error('This download link has expired. Analyze the URL again.');
  return payload;
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8192) throw new Error('Request is too large.');
  }
  return JSON.parse(body || '{}');
}

async function analyze(request, response) {
  try {
    const { url } = await readJson(request);
    if (typeof url !== 'string' || !url || url.length > 2048) return json(response, 400, { error: 'A valid URL is required.' });
    const { result, finalUrl } = await fetchChecked(url, 'HEAD');
    if (!result.ok && result.status !== 206) throw new Error(`The source returned status ${result.status}.`);
    const contentType = (result.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const extension = extname(finalUrl.pathname).toLowerCase();
    if (!(contentType.startsWith('video/') || contentType.startsWith('audio/') || allowedExtensions.has(extension))) {
      throw new Error('The link does not point to a supported direct media file.');
    }
    const size = Number(result.headers.get('content-length') || 0);
    if (size > maxBytes) throw new Error('The file is larger than the 500 MB limit.');
    const filename = safeFilename(finalUrl, contentType);
    const token = encodeToken({ url: finalUrl.href, filename, expires: Date.now() + 10 * 60_000 });
    json(response, 200, { filename, contentType, size: size || null, downloadUrl: `/api/download?token=${encodeURIComponent(token)}` });
  } catch (error) {
    json(response, 400, { error: error.name === 'AbortError' ? 'The source took too long to respond.' : error.message || 'Could not inspect this link.' });
  }
}

async function download(request, response, token) {
  if (activeDownloads >= maxConcurrentDownloads) return json(response, 429, { error: 'The server is busy. Try again shortly.' });
  activeDownloads += 1;
  try {
    const payload = decodeToken(token);
    const { result } = await fetchChecked(payload.url, 'GET');
    if (!result.ok || !result.body) throw new Error('The media source could not be downloaded.');
    const contentType = (result.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    const claimedSize = Number(result.headers.get('content-length') || 0);
    if (claimedSize > maxBytes) throw new Error('The file is larger than the 500 MB limit.');
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${payload.filename.replace(/["\r\n]/g, '-')}"`,
      'Cache-Control': 'private, no-store',
      ...(claimedSize ? { 'Content-Length': String(claimedSize) } : {})
    });
    let received = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > maxBytes) return callback(new Error('Download exceeded the size limit.'));
        callback(null, chunk);
      }
    });
    Readable.fromWeb(result.body).pipe(limiter).pipe(response);
    await new Promise((resolve, reject) => {
      response.on('finish', resolve);
      response.on('close', resolve);
      limiter.on('error', reject);
    });
  } catch (error) {
    if (!response.headersSent) json(response, 400, { error: error.message || 'Download failed.' });
    else response.destroy();
  } finally {
    activeDownloads -= 1;
  }
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  try {
    const body = await readFile(join(root, safePath));
    response.writeHead(200, {
      'Content-Type': staticTypes[extname(safePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method === 'POST' && url.pathname === '/api/analyze') return analyze(request, response);
  if (request.method === 'GET' && url.pathname === '/api/download') return download(request, response, url.searchParams.get('token'));
  if (request.method === 'GET') return serveStatic(request, response, url.pathname);
  json(response, 405, { error: 'Method not allowed.' });
});

server.listen(port, host, () => console.log(`Drift is running on port ${port}`));
