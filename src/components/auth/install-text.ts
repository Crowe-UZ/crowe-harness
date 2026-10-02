/** Wording and platform data for the "Install Claude Code" flow. */

import type { InstallChannel, InstallErrorCode, InstallPhase } from "@/features/native/contract";

/** Official setup guide (shown as copyable text: the webview cannot open external links). */
export const SETUP_DOCS_URL = "https://code.claude.com/docs/en/setup";

export const PHASES: readonly InstallPhase[] = [
  "resolving",
  "verifying_manifest",
  "downloading",
  "verifying_binary",
  "installing",
  "checking",
];

export const PHASE_LABELS = {
  resolving: "Checking the latest version",
  verifying_manifest: "Verifying Anthropic's signature",
  downloading: "Downloading",
  verifying_binary: "Verifying the download",
  installing: "Installing",
  checking: "Checking the installation",
} as const satisfies Record<InstallPhase, string>;

export const CHANNELS: readonly { value: InstallChannel; label: string; hint: string }[] = [
  { value: "stable", label: "Stable (recommended)", hint: "Well-tested releases." },
  { value: "latest", label: "Latest", hint: "The newest release, as soon as it is published." },
];

export interface InstallErrorCopy {
  title: string;
  message: string;
  /** The download failed verification: shown with a security tone. */
  security: boolean;
  /** Trying again can help (false for an unsupported platform). */
  retryable: boolean;
  /** The code is one of the documented `InstallErrorCode`s. */
  known: boolean;
}

const NOT_VERIFIED = "Download could not be verified";
const NOTHING_INSTALLED =
  "Nothing was installed. Try again on a network you trust, or install Claude Code another way.";

const ERRORS = {
  network: {
    title: "Could not download Claude Code",
    message:
      "Crowe Harness could not reach downloads.claude.ai. Check your internet connection and proxy settings, then try again.",
    security: false,
    retryable: true,
  },
  unexpected_response: {
    title: "Could not download Claude Code",
    message:
      "downloads.claude.ai sent an unexpected response. Claude Code may not be available in your region, or a proxy or network filter is blocking the download.",
    security: false,
    retryable: true,
  },
  signature_invalid: {
    title: NOT_VERIFIED,
    message: `The release information is not signed with Anthropic's release key. ${NOTHING_INSTALLED}`,
    security: true,
    retryable: true,
  },
  checksum_mismatch: {
    title: NOT_VERIFIED,
    message: `The downloaded file does not match the checksum Anthropic published and was deleted. ${NOTHING_INSTALLED}`,
    security: true,
    retryable: true,
  },
  publisher_untrusted: {
    title: NOT_VERIFIED,
    message: `The downloaded program is not signed by Anthropic and was deleted. ${NOTHING_INSTALLED}`,
    security: true,
    retryable: true,
  },
  disk_full: {
    title: "Not enough disk space",
    message: "There is not enough free disk space to install Claude Code. Free up some space, then try again.",
    security: false,
    retryable: true,
  },
  install_failed: {
    title: "Claude Code could not be installed",
    message: "The Claude Code installer reported an error. Try again, or install Claude Code another way.",
    security: false,
    retryable: true,
  },
  busy: {
    title: "An installation is already running",
    message: "Another Claude Code installation is in progress. Wait for it to finish, then try again.",
    security: false,
    retryable: true,
  },
  unsupported_platform: {
    title: "This computer is not supported",
    message:
      "The built-in installer does not support this computer's operating system or processor. Try one of the other ways to install below.",
    security: false,
    retryable: false,
  },
} as const satisfies Record<InstallErrorCode, Omit<InstallErrorCopy, "known">>;

function isInstallErrorCode(code: string): code is InstallErrorCode {
  return Object.hasOwn(ERRORS, code);
}

/** Human wording for an install (or plan) error code. */
export function describeInstallError(code: string): InstallErrorCopy {
  if (isInstallErrorCode(code)) return { ...ERRORS[code], known: true };
  return {
    title: "Claude Code could not be installed",
    message: "Something went wrong while installing Claude Code. Try again, or install Claude Code another way.",
    security: false,
    retryable: true,
    known: false,
  };
}

export type InstallOs = "windows" | "macos" | "linux";

export const OS_LABELS = { windows: "Windows", macos: "macOS", linux: "Linux" } as const satisfies Record<
  InstallOs,
  string
>;

/** Official install commands per operating system (code.claude.com/docs/en/setup). */
export const OTHER_INSTALL_METHODS = {
  windows: [
    { label: "PowerShell", command: "irm https://claude.ai/install.ps1 | iex" },
    { label: "WinGet", command: "winget install Anthropic.ClaudeCode" },
  ],
  macos: [
    { label: "Terminal", command: "curl -fsSL https://claude.ai/install.sh | bash" },
    { label: "Homebrew", command: "brew install --cask claude-code" },
  ],
  linux: [{ label: "Terminal", command: "curl -fsSL https://claude.ai/install.sh | bash" }],
} as const satisfies Record<InstallOs, readonly { label: string; command: string }[]>;

/** OS of an `InstallPlan.platform` such as "win32-x64", "darwin-arm64" or "linux-x64-musl". */
export function osFromPlatform(platform: string | undefined): InstallOs | undefined {
  if (!platform) return undefined;
  if (platform.startsWith("win32")) return "windows";
  if (platform.startsWith("darwin")) return "macos";
  if (platform.startsWith("linux")) return "linux";
  return undefined;
}

type NavigatorWithUaData = Navigator & { userAgentData?: { platform?: string } };

/** Best guess of the OS the webview runs on (User-Agent Client Hints, then `platform` / `userAgent`). */
export function detectOs(nav: NavigatorWithUaData | undefined = globalThis.navigator): InstallOs | undefined {
  if (!nav) return undefined;
  const hints = [nav.userAgentData?.platform, nav.platform, nav.userAgent].filter(Boolean).join(" ").toLowerCase();
  // macOS first: "darwin" contains "win".
  if (/mac|darwin/.test(hints)) return "macos";
  if (/win/.test(hints)) return "windows";
  if (/linux|x11/.test(hints)) return "linux";
  return undefined;
}
