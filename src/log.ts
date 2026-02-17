const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

function timestamp(): string {
  return DIM + new Date().toISOString().slice(11, 19) + RESET;
}

export function info(message: string): void {
  console.log(`${timestamp()} ${CYAN}ℹ${RESET}  ${message}`);
}

export function success(message: string): void {
  console.log(`${timestamp()} ${GREEN}✔${RESET}  ${message}`);
}

export function warn(message: string): void {
  console.log(`${timestamp()} ${YELLOW}⚠${RESET}  ${message}`);
}

export function error(message: string): void {
  console.error(`${timestamp()} ${RED}✖${RESET}  ${message}`);
}

export function debug(message: string): void {
  if (verboseEnabled) {
    console.log(`${timestamp()} ${DIM}·  ${message}${RESET}`);
  }
}

export function heading(message: string): void {
  console.log(`\n${BOLD}${CYAN}▸ ${message}${RESET}`);
}

export function summary(label: string, value: string | number): void {
  console.log(`  ${DIM}${label}:${RESET} ${BOLD}${value}${RESET}`);
}
