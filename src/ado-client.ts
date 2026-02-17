import { AzureCliCredential } from "@azure/identity";
import * as azdev from "azure-devops-node-api";
import { IGitApi } from "azure-devops-node-api/GitApi.js";
import { ICoreApi } from "azure-devops-node-api/CoreApi.js";
import { BearerCredentialHandler } from "azure-devops-node-api/handlers/bearertoken.js";
import * as log from "./log.js";

const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

async function getAdoToken(): Promise<string> {
  try {
    log.debug("Requesting token for Azure DevOps resource…");
    const credential = new AzureCliCredential();
    const response = await credential.getToken(`${ADO_RESOURCE}/.default`);
    log.debug("Token acquired successfully");
    return response.token;
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to obtain Azure DevOps token via AzureCliCredential. ` +
        `Make sure you are logged in with \`az login\`.\n${msg}`,
      { cause: err },
    );
  }
}

async function createConnection(orgUrl: string, token: string): Promise<{ gitApi: IGitApi; coreApi: ICoreApi }> {
  log.debug(`Connecting to ${orgUrl}…`);
  const handler = new BearerCredentialHandler(token);
  const connection = new azdev.WebApi(orgUrl, handler);
  const gitApi = await connection.getGitApi();
  const coreApi = await connection.getCoreApi();
  return { gitApi, coreApi };
}

// Cache of org URL -> connection
const connectionCache = new Map<string, { gitApi: IGitApi; coreApi: ICoreApi }>();

export async function getGitApiForOrg(orgUrl: string): Promise<IGitApi> {
  if (!connectionCache.has(orgUrl)) {
    const token = await getAdoToken();
    const conn = await createConnection(orgUrl, token);
    connectionCache.set(orgUrl, conn);
  }
  return connectionCache.get(orgUrl)!.gitApi;
}


