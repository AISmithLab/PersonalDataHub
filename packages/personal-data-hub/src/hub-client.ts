/**
 * Thin HTTP client wrapping the Peekaboo App API endpoints.
 * The extension does not know about manifests or policies — it simply
 * sends requests with a `purpose` string. The Hub resolves the policy internally.
 */

export interface PullParams {
  source: string;
  type?: string;
  params?: Record<string, unknown>;
  purpose: string;
}

export interface ProposeParams {
  source: string;
  action_type: string;
  action_data: Record<string, unknown>;
  purpose: string;
}

export interface PullResult {
  ok: boolean;
  data: Array<{
    source: string;
    source_item_id: string;
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  }>;
  meta?: Record<string, unknown>;
}

export interface ProposeResult {
  ok: boolean;
  actionId: string;
  status: string;
}

export interface HubClientConfig {
  hubUrl: string;
  apiKey: string;
}

export class HubClient {
  private hubUrl: string;
  private apiKey: string;

  constructor(config: HubClientConfig) {
    this.hubUrl = config.hubUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  /**
   * Pull data from a source through Peekaboo.
   * The Hub applies the owner's manifest/policy to filter, redact, and shape the data.
   */
  async pull(params: PullParams): Promise<PullResult> {
    const res = await fetch(`${this.hubUrl}/app/v1/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new HubApiError('pull', res.status, text);
    }

    return res.json() as Promise<PullResult>;
  }

  /**
   * Propose an outbound action through Peekaboo staging.
   * The action goes to the owner's staging queue for review before execution.
   */
  async propose(params: ProposeParams): Promise<ProposeResult> {
    const res = await fetch(`${this.hubUrl}/app/v1/propose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new HubApiError('propose', res.status, text);
    }

    return res.json() as Promise<ProposeResult>;
  }
}

export class HubApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`Peekaboo API error on ${endpoint}: ${statusCode} - ${body}`);
    this.name = 'HubApiError';
  }
}
