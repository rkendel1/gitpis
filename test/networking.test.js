import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkingManager } from '../src/networking.js';

test('NetworkingManager allocates, lists, and releases routes', async () => {
  const manager = new NetworkingManager({ baseDomain: 'ddockit.app' });
  const route = await manager.allocateRoute('workspace-abc123', 5173);
  assert.equal(route.port, 5173);
  assert.equal(route.protocol, 'https');
  assert.ok(route.host.endsWith('.ddockit.app'));

  const routes = await manager.routes('workspace-abc123');
  assert.equal(routes.length, 1);

  const stats = await manager.stats();
  assert.equal(stats.RouteCount, 1);
  assert.equal(stats.ActiveUrls, 1);

  await manager.releaseRoute('workspace-abc123', route.id);
  assert.equal((await manager.routes('workspace-abc123')).length, 0);
});

test('NetworkingManager custom domains can be verified', async () => {
  const manager = new NetworkingManager();
  await manager.allocateRoute('workspace-custom', 3000);
  const domain = await manager.addCustomDomain('workspace-custom', 'my-app.com');
  assert.equal(domain.status, 'pending');
  const verified = await manager.verifyDomain('my-app.com');
  assert.equal(verified.status, 'verified');
  assert.equal((await manager.domains('workspace-custom')).length, 1);
});
