import { DefaultAzureCredential } from "@azure/identity";
import * as azdev from "azure-devops-node-api";
import { IGitApi } from "azure-devops-node-api/GitApi.js";
import { IBuildApi } from "azure-devops-node-api/BuildApi.js";
import { ICoreApi } from "azure-devops-node-api/CoreApi.js";
import { BearerCredentialHandler } from "azure-devops-node-api/handlers/bearertoken.js";
import * as log from "./log.js";

const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

async function getAdoToken(): Promise<string> {
  // In Azure Pipelines the agent exposes SYSTEM_ACCESSTOKEN which can be used directly
  const systemToken = process.env.SYSTEM_ACCESSTOKEN;
  if (systemToken) {
    log.debug("Using SYSTEM_ACCESSTOKEN from Azure Pipelines environment");
    return systemToken;
  }

  try {
    log.debug("Requesting token for Azure DevOps resource via DefaultAzureCredential…");
    const credential = new DefaultAzureCredential();
    const response = await credential.getToken(`${ADO_RESOURCE}/.default`);
    log.debug("Token acquired successfully");
    return response.token;
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to obtain Azure DevOps token. ` +
        `Set SYSTEM_ACCESSTOKEN in Azure Pipelines, or configure environment ` +
        `credentials (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET), ` +
        `or log in with \`az login\`.\n${msg}`,
      { cause: err },
    );
  }
}

async function createConnection(orgUrl: string, token: string): Promise<{ gitApi: IGitApi; buildApi: IBuildApi; coreApi: ICoreApi }> {
  log.debug(`Connecting to ${orgUrl}…`);
  const handler = new BearerCredentialHandler(token);
  const connection = new azdev.WebApi(orgUrl, handler);
  const gitApi = await connection.getGitApi();
  const buildApi = await connection.getBuildApi();
  const coreApi = await connection.getCoreApi();
  return { gitApi, buildApi, coreApi };
}

// Cache of org URL -> connection
const connectionCache = new Map<string, { gitApi: IGitApi; buildApi: IBuildApi; coreApi: ICoreApi }>();

export async function getGitApiForOrg(orgUrl: string): Promise<IGitApi> {
  if (!connectionCache.has(orgUrl)) {
    const token = await getAdoToken();
    const conn = await createConnection(orgUrl, token);
    connectionCache.set(orgUrl, conn);
  }
  return connectionCache.get(orgUrl)!.gitApi;
}

export async function getBuildApiForOrg(orgUrl: string): Promise<IBuildApi> {
  if (!connectionCache.has(orgUrl)) {
    const token = await getAdoToken();
    const conn = await createConnection(orgUrl, token);
    connectionCache.set(orgUrl, conn);
  }
  return connectionCache.get(orgUrl)!.buildApi;
}


