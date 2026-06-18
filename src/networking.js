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
