export interface RpcConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export type AddNodeCommand = "add" | "remove" | "onetry";

/** `getp2pmsginfo` result. All fields but `enabled` are absent when disabled. */
export interface P2pmsgInfo {
  enabled: boolean;
  identity_pubkey?: string;
  inbox_pubkey?: string;
  prekey_sig?: string;
  pings_received?: number;
  relay_capable_peers?: number;
}

/** `getaggregationhint` result (private-send cover-candidate pool). */
export interface AggregationHint {
  enabled: boolean;
  available?: number;
  candidate_weight?: number;
  blsct_default_fee?: number;
  extra_fee_per_candidate?: number;
}

/** `listorders` result (aggregate counts only; individual orders stay private). */
export interface ListOrdersResult {
  enabled: boolean;
  count?: number;
  bytes?: number;
}

/** One entry of `liststakedcommitmentsdata` (public unspent staked set). */
export interface StakedCommitmentData {
  commitment: string;
  outhash: string;
  /** Full predicate hex (op + compact size + payload), "" when none. */
  predicate: string;
  height: number;
  confirmations: number;
}

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

  // --- p2pmsg / P2P overlay -------------------------------------------------
  // These RPCs are optional: a pre-p2pmsg node returns method-not-found and a
  // node with the overlay disabled may throw "p2pmsg disabled". In every such
  // case we swallow the error and report a disabled/empty result so the indexer
  // keeps running against any node.

  async getP2pmsgInfo(): Promise<P2pmsgInfo> {
    try {
      return (await this.call("getp2pmsginfo")) as P2pmsgInfo;
    } catch {
      return { enabled: false };
    }
  }

  async getAggregationHint(): Promise<AggregationHint> {
    try {
      return (await this.call("getaggregationhint")) as AggregationHint;
    } catch {
      return { enabled: false };
    }
  }

  async listOrders(): Promise<ListOrdersResult> {
    try {
      return (await this.call("listorders")) as ListOrdersResult;
    } catch {
      return { enabled: false };
    }
  }

  // --- staking --------------------------------------------------------------

  /**
   * Public unspent staked-commitment set. Returns null when the node predates
   * the RPC (method not found) so callers can tell "unsupported" from "empty".
   */
  async listStakedCommitmentsData(): Promise<StakedCommitmentData[] | null> {
    try {
      const result = await this.call("liststakedcommitmentsdata");
      return Array.isArray(result) ? (result as StakedCommitmentData[]) : [];
    } catch {
      return null;
    }
  }

  async listRfqs(): Promise<string[]> {
    try {
      const result = await this.call("listrfqs");
      return Array.isArray(result) ? (result as string[]) : [];
    } catch {
      return [];
    }
  }
}
