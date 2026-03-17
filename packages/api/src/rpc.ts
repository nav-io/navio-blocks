let requestId = 0;

export interface RpcResponse<T = unknown> {
  result: T;
  error: { code: number; message: string } | null;
  id: number;
}

function rpcConfig(): {
  host: string;
  port: string;
  user: string;
  password: string;
} {
  const host = process.env.RPC_HOST ?? '127.0.0.1';
  const port = process.env.RPC_PORT ?? '33677';
  const user = process.env.RPC_USER ?? '';
  const password = process.env.RPC_PASSWORD ?? '';
  return { host, port, user, password };
}

/**
 * Call a naviod JSON-RPC method.
 */
export async function rpcCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const { host, port, user, password } = rpcConfig();
  if (!user || !password) {
    throw new Error('Missing RPC credentials. Set RPC_USER and RPC_PASSWORD.');
  }

  const id = ++requestId;
  const url = `http://${host}:${port}/`;
  const auth = Buffer.from(`${user}:${password}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id, method, params }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as RpcResponse<T>;

  if (body.error) {
    throw new Error(`RPC error ${body.error.code}: ${body.error.message}`);
  }

  return body.result;
}
