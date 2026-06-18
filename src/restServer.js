import http from 'node:http';
import { createWasmWorkspace } from './index.js';

const workspace = createWasmWorkspace();

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/workspaces') {
      const body = await readBody(req);
      const launched = await workspace.launch(body.repoUrl);
      json(res, 201, launched);
      return;
    }

    if (req.method === 'GET' && req.url === '/workspaces') {
      json(res, 200, workspace.list());
      return;
    }

    const match = req.url?.match(/^\/workspaces\/([^/]+)(?:\/(stop|restart|ports|health|logs|events))?$/);
    if (match) {
      const [, id, action] = match;

      if (!action && req.method === 'GET') {
        const item = workspace.list().find((w) => w.id === id);
        if (!item) {
          json(res, 404, { error: 'Not found' });
          return;
        }
        json(res, 200, item);
        return;
      }

      if (action === 'stop' && req.method === 'POST') {
        await workspace.stop(id);
        json(res, 200, { ok: true });
        return;
      }

      if (action === 'restart' && req.method === 'POST') {
        const restarted = await workspace.restart(id);
        json(res, 200, restarted);
        return;
      }

      if (action === 'ports' && req.method === 'GET') {
        const ports = await workspace.ports(id);
        json(res, 200, ports);
        return;
      }

      if (action === 'health' && req.method === 'GET') {
        const health = await workspace.health(id);
        json(res, 200, { health });
        return;
      }

      if (action === 'logs' && req.method === 'GET') {
        json(res, 200, workspace.getLogs(id));
        return;
      }

      if (action === 'events' && req.method === 'GET') {
        const events = await workspace.events(id);
        json(res, 200, events);
        return;
      }
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

const port = Number(process.env.PORT || 8088);
server.listen(port, () => {
  process.stdout.write(`WASM workspace API listening on :${port}\n`);
});
