export function derivePorts(framework, executionPlan) {
  const defaultPort = executionPlan?.defaultPort ?? 8080;
  const protocol = 'http';

  return [
    {
      port: defaultPort,
      protocol,
      visibility: 'public',
      route: `/${defaultPort}`
    }
  ];
}
