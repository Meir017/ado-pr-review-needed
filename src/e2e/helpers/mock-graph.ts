import { vi } from "vitest";

/**
 * Sets up vi.mock for the graph-client module.
 * Call this at the top of test files that need graph mocking.
 *
 * Usage in test file:
 *   vi.mock("../../graph-client.js", () => createMockGraphModule());
 */
export function createMockGraphModule() {
  return {
    fetchDirectReports: vi.fn().mockResolvedValue([]),
    fetchOrgMembers: vi.fn().mockResolvedValue({ members: [], managers: [] }),
  };
}

/**
 * Returns a mock graph module that resolves to specific team members.
 */
export function createMockGraphModuleWithMembers(members: string[], managers: string[] = []) {
  return {
    fetchDirectReports: vi.fn().mockResolvedValue(members),
    fetchOrgMembers: vi.fn().mockResolvedValue({ members, managers }),
  };
}
