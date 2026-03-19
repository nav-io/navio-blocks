export interface RpcConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export type AddNodeCommand = "add" | "remove" | "onetry";

export class RpcClient {
  private url: string;
  private authHeader: string;
  private idCounter = 0;

  constructor(config: RpcConfig) {
    this.url = `http://${config.host}:${config.port}/`;
    this.authHeader =
      "Basic " + Buffer.from(`${config.user}:${config.password}`).toString("base64");
  }

  async call(method: string, params: unknown[] = []): Promise<unknown> {
    const id = ++this.idCounter;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `RPC HTTP error ${res.status} for method '${method}': ${text}`
      );
    }

    const json = (await res.json()) as {
      result?: unknown;
      error?: { code: number; message: string };
    };

    if (json.error) {
      throw new Error(
        `RPC error ${json.error.code} for method '${method}': ${json.error.message}`
      );
    }

    return json.result;
  }

  async getBlockCount(): Promise<number> {
    return (await this.call("getblockcount")) as number;
  }

  async getBlockHash(height: number): Promise<string> {
    return (await this.call("getblockhash", [height])) as string;
  }

  async getBlock(hash: string, verbosity = 2): Promise<unknown> {
    return await this.call("getblock", [hash, verbosity]);
  }

  async getRawTransaction(
    txid: string,
    verbose = true
  ): Promise<unknown> {
    return await this.call("getrawtransaction", [txid, verbose]);
  }

  async decodeRawTransaction(rawTxHex: string): Promise<unknown> {
    return await this.call("decoderawtransaction", [rawTxHex]);
  }

  async getMempoolInfo(): Promise<unknown> {
    return await this.call("getmempoolinfo");
  }

  async getPeerInfo(): Promise<unknown[]> {
    return (await this.call("getpeerinfo")) as unknown[];
  }

  async getNetworkHashPS(): Promise<number> {
    return (await this.call("getnetworkhashps")) as number;
  }

  async getBlockchainInfo(): Promise<unknown> {
    return await this.call("getblockchaininfo");
  }

  async getNodeAddresses(count = 0): Promise<unknown[]> {
    return (await this.call("getnodeaddresses", [count])) as unknown[];
  }

  async addNode(node: string, command: AddNodeCommand = "add"): Promise<void> {
    await this.call("addnode", [node, command]);
  }

  async getAddedNodeInfo(node?: string): Promise<unknown[]> {
    const params = node ? [node] : [];
    return (await this.call("getaddednodeinfo", params)) as unknown[];
  }
}
