type KeyClient={query(sql: string, params?: string[]): Promise<{rows: {fingerprint?: string; existing?: boolean}[]}>};
export function guardRuntimeKey(client: KeyClient, key: string | undefined): Promise<void>;
export function assertRuntimeKey(client: KeyClient, key: string | undefined): Promise<void>;
