declare module 'fastify' {
  export interface FastifyRequest {
    body?: any;
    params?: any;
    query?: any;
    ip?: string;
    log: {
      error: (err: any, msg?: string) => void;
    };
    isMultipart(): boolean;
    parts(): any;
  }

  export interface FastifyReply {
    code(code: number): FastifyReply;
    send(payload: any): any;
    type(contentType: string): FastifyReply;
  }

  export interface FastifyInstance {
    post<T = any>(path: string, handler: any): any;
    post<T = any>(path: string, opts: any, handler: any): any;
    get<T = any>(path: string, handler: any): any;
    get<T = any>(path: string, opts: any, handler: any): any;
    listen(opts: any): Promise<any>;
    close(): Promise<any>;
    decorate(name: string, value: any): any;
    register(plugin: any, opts?: any): Promise<any>;
    route(opts: any): any;
  }
}
