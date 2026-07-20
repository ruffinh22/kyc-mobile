declare module 'fastify' {
  export interface FastifyRequest {
    body?: any;
    params?: any;
    query?: any;
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
    user?: any;
    log: any;
    isMultipart(): boolean;
    parts(): any;
  }

  export interface FastifyReply {
    code(code: number): FastifyReply;
    send(payload: any): any;
    type(contentType: string): FastifyReply;
    header(name: string, value: any): FastifyReply;
    raw: any;
  }

  export interface FastifyError extends Error {
    statusCode?: number;
    code?: string;
    validation?: any;
  }

  export interface FastifyInstance {
    addHook(name: string, hook: any): void;
    post(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    post(path: string, opts: any, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    get(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    get(path: string, opts: any, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    put(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    put(path: string, opts: any, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    delete(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    delete(path: string, opts: any, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    patch(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    patch(path: string, opts: any, handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    listen(opts: any): Promise<any>;
    close(): Promise<any>;
    decorate(name: string, value: any): any;
    register(plugin: any, opts?: any): Promise<any>;
    route(opts: any): any;
    setErrorHandler(handler: (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => any): any;
    setNotFoundHandler(handler: (req: FastifyRequest, reply: FastifyReply) => any): any;
    log: any;
  }

  export default function Fastify(opts?: any): FastifyInstance;
}
