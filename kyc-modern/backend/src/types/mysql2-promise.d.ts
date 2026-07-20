declare module 'mysql2/promise' {
  export interface Pool {
    execute<T = any>(sql: string, values?: any[]): Promise<[T, any]>;
    query<T = any>(sql: string, values?: any[]): Promise<[T, any]>;
    getConnection(): Promise<any>;
  }

  export interface ResultSetHeader {
    insertId: number;
    affectedRows: number;
    warningStatus: number;
  }

  export interface RowDataPacket {
    [key: string]: any;
  }

  export interface PoolOptions {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    waitForConnections?: boolean;
    connectionLimit?: number;
    queueLimit?: number;
    enableKeepAlive?: boolean;
    timezone?: string;
    charset?: string;
  }

  export function createPool(config: PoolOptions): Pool;
}
