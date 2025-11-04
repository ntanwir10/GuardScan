type RouteHandler = (request: Request, params?: any) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
  keys: string[];
}

export class Router {
  private routes: Route[] = [];

  private addRoute(method: string, path: string, handler: RouteHandler): void {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path
          .replace(/\//g, '\\/')
          .replace(/:(\w+)/g, (_, key) => {
            keys.push(key);
            return '([^\\/]+)';
          }) +
        '$'
    );

    this.routes.push({ method, pattern, handler, keys });
  }

  get(path: string, handler: RouteHandler): void {
    this.addRoute('GET', path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute('POST', path, handler);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    for (const route of this.routes) {
      if (route.method !== method) continue;

      const match = path.match(route.pattern);
      if (match) {
        const params: any = {};
        route.keys.forEach((key, index) => {
          params[key] = match[index + 1];
        });

        return await route.handler(request, params);
      }
    }

    return new Response('Not Found', { status: 404 });
  }
}
