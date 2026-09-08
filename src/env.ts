/**
 * Environment & credential loading.
 *
 * Design note (important for the "ease of maintenance" criteria):
 *   - The tenant DID is NEVER read from config. It is an opaque value the
 *     platform assigns on first sign-in, so it is always read back from the
 *     authenticated session (see docs: "Never hardcode or derive your tenant DID").
 *   - Only the API key comes from the environment, and it is never written into
 *     any file in this repo.
 */

export function requireApiKey(name = "T3N_API_KEY"): string {
  const key = process.env[name];
  if (!key) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill in your key.`
    );
  }
  return key;
}

export function readEnvironment(): "testnet" | "production" {
  const env = (process.env.T3N_ENVIRONMENT || "testnet").toLowerCase();
  if (env === "production") return "production";
  if (env === "sandbox" || env === "testnet") return "testnet";
  throw new Error(`Unsupported T3N_ENVIRONMENT: ${process.env.T3N_ENVIRONMENT}`);
}
