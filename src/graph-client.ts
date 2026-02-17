import { AzureCliCredential } from "@azure/identity";
import * as log from "./log.js";
import { withRetry, NonRetryableError } from "./retry.js";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface GraphUser {
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

interface GraphResponse {
  value: GraphUser[];
  "@odata.nextLink"?: string;
}

async function getGraphToken(): Promise<string> {
  try {
    const credential = new AzureCliCredential();
    const response = await credential.getToken(GRAPH_SCOPE);
    return response.token;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to get Microsoft Graph token via AzureCliCredential. ` +
        `Make sure you are logged in with \`az login\`.\n${msg}`,
      { cause: err },
    );
  }
}

async function graphGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    // 4xx errors are client errors — retrying won't help
    if (res.status >= 400 && res.status < 500) {
      throw new NonRetryableError(`Graph API ${res.status}: ${body}`);
    }
    throw new Error(`Graph API ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

async function getDirectReportsEmails(
  token: string,
  upn: string,
): Promise<string[]> {
  const emails: string[] = [];
  let url: string | undefined =
    `${GRAPH_BASE}/users/${encodeURIComponent(upn)}/directReports?$select=mail,userPrincipalName,displayName&$top=999`;

  while (url) {
    const data = await withRetry(`Fetch direct reports for ${upn}`, () =>
      graphGet<GraphResponse>(token, url!),
    );

    for (const user of data.value) {
      // Add both mail and UPN so alias matches work
      const mail = user.mail?.toLowerCase();
      const principal = user.userPrincipalName?.toLowerCase();
      if (mail) emails.push(mail);
      if (principal && principal !== mail) emails.push(principal);
    }

    url = data["@odata.nextLink"];
  }

  return emails;
}

export async function fetchDirectReports(managerUpn: string): Promise<string[]> {
  log.info(`Fetching direct reports for ${managerUpn} from Microsoft Graph…`);
  const token = await getGraphToken();
  const emails = await getDirectReportsEmails(token, managerUpn);
  log.success(`Found ${emails.length} direct reports for ${managerUpn}`);
  for (const e of emails) log.debug(`  ${e}`);
  return emails;
}

export interface OrgMembersResult {
  members: string[];
  managers: string[];
}

export async function fetchOrgMembers(orgManagerUpn: string): Promise<OrgMembersResult> {
  log.info(`Fetching full org tree under ${orgManagerUpn} from Microsoft Graph…`);
  const token = await getGraphToken();

  const CONCURRENCY = 10;
  const allMembers: string[] = [];
  const allManagers: string[] = [orgManagerUpn.toLowerCase()];
  let currentLevel: string[] = [orgManagerUpn];
  const visited = new Set<string>();

  while (currentLevel.length > 0) {
    // Deduplicate against already-visited
    const toProcess = currentLevel.filter((e) => !visited.has(e));
    for (const e of toProcess) visited.add(e);

    if (toProcess.length === 0) break;

    log.debug(`  Processing ${toProcess.length} users (concurrency: ${CONCURRENCY})…`);

    const nextLevel: string[] = [];
    // Process in batches of CONCURRENCY
    for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
      const batch = toProcess.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (upn) => {
          try {
            const reports = await getDirectReportsEmails(token, upn);
            log.debug(`    ${upn} → ${reports.length} direct reports`);
            return { upn, reports };
          } catch (err: unknown) {
            if (err instanceof NonRetryableError && err.message.includes("404")) {
              log.warn(`  ${upn} — not found in directory, keeping as member`);
              return { upn, reports: [upn] };
            }
            throw err;
          }
        }),
      );
      for (const { upn, reports } of results) {
        if (reports.length > 0 && !(reports.length === 1 && reports[0] === upn)) {
          allManagers.push(upn.toLowerCase());
        }
        for (const email of reports) {
          allMembers.push(email);
          nextLevel.push(email);
        }
      }
    }

    currentLevel = nextLevel;
  }

  log.success(`Found ${allMembers.length} total org members under ${orgManagerUpn} (${allManagers.length} managers)`);
  return { members: allMembers, managers: allManagers };
}
