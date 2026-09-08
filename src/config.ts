import "dotenv/config";

export interface AgentConfig {
  apiKey: string;
  tenantDid: string;
  environment: "testnet" | "production";
  appName: string;
  agentRole: string;
}

export function loadConfig(): AgentConfig {
  const apiKey = process.env.T3N_API_KEY;
  if (!apiKey) {
    throw new Error("CRITICAL: T3N_API_KEY is not defined in environment.");
  }

  const tenantDid = process.env.T3N_TENANT_DID || "did:t3n:unknown";
  const environment = (process.env.T3N_ENVIRONMENT as "testnet" | "production") || "testnet";

  return {
    apiKey,
    tenantDid,
    environment,
    appName: "T3N DataGuard Enterprise Agent",
    agentRole: "Confidential Compliance & Audit Attestor",
  };
}
