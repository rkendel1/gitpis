import { randomUUID } from 'node:crypto';

const DEFAULT_PROTOCOL = 'https';
const DEFAULT_BASE_DOMAIN = 'ddockit.app';
const DEFAULT_NODE_ID = 'node-local';
const DEFAULT_INGRESS_POLICY = Object.freeze({ allowIngress: true });
const DEFAULT_EGRESS_POLICY = Object.freeze({
  allowedHosts: [],
  blockedHosts: [],
  rateLimitPerMinute: null,
  internetAccess: 'restricted'
});

function sanitizeWorkspaceId(workspaceId) {
  return String(workspaceId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || 'workspace';
}

export class UrlGenerator {
  constructor(options = {}) {
    this.baseDomain = options.baseDomain ?? DEFAULT_BASE_DOMAIN;
    this.protocol = options.protocol ?? DEFAULT_PROTOCOL;
  }

  host(workspaceId, port) {
    const slug = sanitizeWorkspaceId(workspaceId);
    const suffix = port ? `-${port}` : '';
    return `${slug}${suffix}.${this.baseDomain}`;
  }

  generate(workspaceId, port) {
    return `${this.protocol}://${this.host(workspaceId, port)}`;
  }
}

export class PortRegistry {
  constructor() {
    this.byWorkspace = new Map();
  }

  async register(workspaceId, port) {
    const workspacePorts = this.byWorkspace.get(workspaceId) ?? new Set();
    workspacePorts.add(port);
    this.byWorkspace.set(workspaceId, workspacePorts);
    return { workspaceId, port };
  }

  async list(workspaceId) {
    return [...(this.byWorkspace.get(workspaceId) ?? [])];
  }

  async release(workspaceId, port) {
    const workspacePorts = this.byWorkspace.get(workspaceId);
    if (!workspacePorts) return;
    if (port === undefined) {
      this.byWorkspace.delete(workspaceId);
      return;
    }
    workspacePorts.delete(port);
    if (workspacePorts.size === 0) {
      this.byWorkspace.delete(workspaceId);
    }
  }
}

export class RouteAllocator {
  constructor(options = {}) {
    this.urlGenerator = options.urlGenerator ?? new UrlGenerator(options);
    this.protocol = options.protocol ?? DEFAULT_PROTOCOL;
    this.nodeId = options.nodeId ?? DEFAULT_NODE_ID;
  }

  async allocate(workspaceId, port) {
    const host = this.urlGenerator.host(workspaceId, port);
    return {
      id: randomUUID(),
      workspaceId,
      port,
      host,
      protocol: this.protocol,
      url: `${this.protocol}://${host}`,
      target: {
        nodeId: this.nodeId,
        workspaceId,
        runtimeAddress: `127.0.0.1:${port}`
      },
      websocket: true,
      sse: true,
      createdAt: new Date().toISOString()
    };
  }
}

export class ReverseProxyProvider {
  constructor() {
    this.routes = new Map();
  }

  async registerRoute(route) {
    this.routes.set(route.id, { ...route });
  }

  async removeRoute(routeId) {
    this.routes.delete(routeId);
  }
}

export class TlsProvider {
  constructor() {
    this.certificates = new Map();
  }

  issueCertificate(domain) {
    const certificate = {
      domain,
      issuedAt: new Date().toISOString(),
      mode: domain.startsWith('*.') ? 'wildcard' : 'managed'
    };
    this.certificates.set(domain, certificate);
    return certificate;
  }

  renewCertificate(domain) {
    return this.issueCertificate(domain);
  }

  revokeCertificate(domain) {
    this.certificates.delete(domain);
  }
}

export class CustomDomainManager {
  constructor(options = {}) {
    this.tlsProvider = options.tlsProvider ?? new TlsProvider();
    this.domains = new Map();
  }

  addDomain(workspaceId, domain, routeId = null) {
    const record = {
      id: randomUUID(),
      workspaceId,
      routeId,
      domain,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    this.domains.set(domain, record);
    return record;
  }

  verifyDomain(domain) {
    const record = this.domains.get(domain);
    if (!record) return null;
    record.status = 'verified';
    record.verifiedAt = new Date().toISOString();
    this.tlsProvider.issueCertificate(domain);
    return record;
  }

  removeDomain(domain) {
    this.domains.delete(domain);
    this.tlsProvider.revokeCertificate(domain);
  }

  listByWorkspace(workspaceId) {
    return [...this.domains.values()].filter((domain) => domain.workspaceId === workspaceId);
  }
}

export class NetworkIsolationPolicy {
  allowIngress() {
    return DEFAULT_INGRESS_POLICY.allowIngress;
  }

  allowEgress(host) {
    return !DEFAULT_EGRESS_POLICY.blockedHosts.includes(host);
  }

  allowWorkspaceToWorkspace() {
    return false;
  }
}

export class ServiceMeshProvider {
  constructor() {
    this.services = new Map();
  }

  registerService(name, target) {
    this.services.set(name, target);
  }

  discoverService(name) {
    return this.services.get(name) ?? null;
  }
}

export class EventStream {
  constructor(events = []) {
    this.events = events;
  }

  *subscribe() {
    for (const event of this.events) {
      yield event;
    }
  }
}

export class RouteHealthChecker {
  async check(route) {
    return {
      routeId: route.id,
      workspaceId: route.workspaceId,
      portResponding: true,
      http200: true,
      runtimeReachable: Boolean(route?.target?.runtimeAddress),
      proxyReachable: true,
      checkedAt: new Date().toISOString()
    };
  }
}

export class PortDiscoveryService {
  async discover(runtime) {
    if (!runtime?.ports) {
      return [];
    }
    const ports = await runtime.ports();
    return ports.map((port) => ({
      ...port,
      discoverySource: port.discoverySource ?? 'runtime-event'
    }));
  }
}

export class NetworkingManager {
  constructor(options = {}) {
    this.portRegistry = options.portRegistry ?? new PortRegistry();
    this.urlGenerator = options.urlGenerator ?? new UrlGenerator(options);
    this.routeAllocator = options.routeAllocator ?? new RouteAllocator({ ...options, urlGenerator: this.urlGenerator });
    this.proxyProvider = options.reverseProxyProvider ?? new ReverseProxyProvider();
    this.tlsProvider = options.tlsProvider ?? new TlsProvider();
    this.customDomainManager = options.customDomainManager ?? new CustomDomainManager({ tlsProvider: this.tlsProvider });
    this.portDiscovery = options.portDiscoveryService ?? new PortDiscoveryService();
    this.networkIsolationPolicy = options.networkIsolationPolicy ?? new NetworkIsolationPolicy();
    this.serviceMeshProvider = options.serviceMeshProvider ?? new ServiceMeshProvider();
    this.routeHealthChecker = options.routeHealthChecker ?? new RouteHealthChecker();
    this.ingressPolicy = options.ingressPolicy ?? { ...DEFAULT_INGRESS_POLICY };
    this.egressPolicy = options.egressPolicy ?? { ...DEFAULT_EGRESS_POLICY };
    this.routesByWorkspace = new Map();
    this.routeIndex = new Map();
    this.metrics = {
      RouteCount: 0,
      ActiveUrls: 0,
      TlsProvisionTime: 0,
      ProxyRegistrationTime: 0,
      PortDiscoveryTime: 0,
      WorkspaceExposureTime: 0
    };
  }

  async discoverPorts(workspaceId, runtime) {
    const startedAt = Date.now();
    const ports = await this.portDiscovery.discover(runtime);
    this.metrics.PortDiscoveryTime += Date.now() - startedAt;
    for (const info of ports) {
      await this.portRegistry.register(workspaceId, info.port);
    }
    return ports;
  }

  async allocateRoute(workspaceId, port) {
    const workspaceRoutes = this.routesByWorkspace.get(workspaceId) ?? [];
    const existing = workspaceRoutes.find((route) => route.port === port);
    if (existing) {
      return existing;
    }

    await this.portRegistry.register(workspaceId, port);
    const exposureStartedAt = Date.now();
    const route = await this.routeAllocator.allocate(workspaceId, port);

    const tlsStartedAt = Date.now();
    this.tlsProvider.issueCertificate(route.host);
    this.metrics.TlsProvisionTime += Date.now() - tlsStartedAt;

    const proxyStartedAt = Date.now();
    await this.proxyProvider.registerRoute(route);
    this.metrics.ProxyRegistrationTime += Date.now() - proxyStartedAt;

    workspaceRoutes.push(route);
    this.routesByWorkspace.set(workspaceId, workspaceRoutes);
    this.routeIndex.set(route.id, route);
    this.metrics.RouteCount = this.routeIndex.size;
    this.metrics.ActiveUrls = this.routeIndex.size;
    this.metrics.WorkspaceExposureTime += Date.now() - exposureStartedAt;
    return route;
  }

  async releaseRoute(workspaceId, routeId) {
    if (!this.routesByWorkspace.has(workspaceId)) return;
    const currentRoutes = this.routesByWorkspace.get(workspaceId) ?? [];
    const keptRoutes = [];

    for (const route of currentRoutes) {
      if (routeId && route.id !== routeId) {
        keptRoutes.push(route);
        continue;
      }
      await this.proxyProvider.removeRoute(route.id);
      this.tlsProvider.revokeCertificate(route.host);
      this.routeIndex.delete(route.id);
      await this.portRegistry.release(workspaceId, route.port);
    }

    if (keptRoutes.length > 0) {
      this.routesByWorkspace.set(workspaceId, keptRoutes);
    } else {
      this.routesByWorkspace.delete(workspaceId);
      await this.portRegistry.release(workspaceId);
    }

    this.metrics.RouteCount = this.routeIndex.size;
    this.metrics.ActiveUrls = this.routeIndex.size;
  }

  async routes(workspaceId) {
    return [...(this.routesByWorkspace.get(workspaceId) ?? [])];
  }

  async allRoutes() {
    return [...this.routeIndex.values()];
  }

  async stats() {
    return { ...this.metrics };
  }

  async workspaceNetwork(workspaceId, runtime) {
    const ports = await this.discoverPorts(workspaceId, runtime);
    const routes = await this.routes(workspaceId);
    return {
      workspaceId,
      ports,
      routes,
      ingressPolicy: this.ingressPolicy,
      egressPolicy: this.egressPolicy
    };
  }

  async addCustomDomain(workspaceId, domain, routeId = null) {
    return this.customDomainManager.addDomain(workspaceId, domain, routeId);
  }

  async verifyDomain(domain) {
    return this.customDomainManager.verifyDomain(domain);
  }

  async removeDomain(domain) {
    return this.customDomainManager.removeDomain(domain);
  }

  async domains(workspaceId) {
    return this.customDomainManager.listByWorkspace(workspaceId);
  }

  async health(routeId) {
    const route = this.routeIndex.get(routeId);
    if (!route) return null;
    return this.routeHealthChecker.check(route);
  }

  async url(workspaceId) {
    const routes = await this.routes(workspaceId);
    return routes[0]?.url ?? null;
  }
}

export function derivePorts(framework, executionPlan) {
  const defaultPort = executionPlan?.defaultPort ?? 8080;
  const protocol = 'http';
  return [
    {
      port: defaultPort,
      protocol,
      publicUrl: `http://localhost:${defaultPort}`,
      visibility: 'public',
      route: `/${defaultPort}`,
      framework
    }
  ];
}
