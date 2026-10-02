import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNative, fixtures, waitForInstall } from "@/test/fakes";
import { renderApp } from "@/test/renderApp";
import { detectOs } from "./install-text";

const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });
const progressbar = () => screen.getByRole("progressbar", { name: "Download progress" });
const phaseAnnouncement = () => screen.getByRole("status");

/** Pins the OS the webview reports, so platform-specific text does not depend on the test machine. */
function setUserAgent(userAgent: string): void {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue("");
}

const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)";

beforeEach(() => {
  fakeNative().status = fixtures.notInstalledStatus();
  setUserAgent(WINDOWS_UA);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openConsent() {
  const view = await renderApp("/");
  await heading("Claude Code not found");
  await view.user.click(screen.getByRole("button", { name: "Install Claude Code" }));
  expect(await heading("Install Claude Code")).toHaveFocus();
  return view;
}

async function startInstall() {
  const view = await openConsent();
  await screen.findByText("2.1.285");
  await view.user.click(screen.getByRole("button", { name: "Install" }));
  expect(await heading("Installing Claude Code")).toHaveFocus();
  return { ...view, install: await waitForInstall() };
}

describe("Install Claude Code — not found", () => {
  it("offers to install Claude Code, with a check-again fallback", async () => {
    const { user } = await renderApp("/");

    expect(await heading("Claude Code not found")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Install Claude Code" })).toBeInTheDocument();
    expect(screen.getByText(/Claude desktop app also includes Claude Code/)).toBeInTheDocument();
    expect(fakeNative().claudeInstallPlan).not.toHaveBeenCalled();

    fakeNative().status = fixtures.signedOutStatus();
    await user.click(screen.getByRole("button", { name: "Check again" }));

    expect(await heading("Sign in with your Claude subscription")).toBeInTheDocument();
  });
});

describe("Install Claude Code — consent", () => {
  it("shows what will be installed and from where", async () => {
    await openConsent();

    expect(await screen.findByText("2.1.285")).toBeInTheDocument();
    expect(screen.getByText("100.0 MB")).toBeInTheDocument();
    expect(screen.getByText("downloads.claude.ai")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\dev\\.local\\bin")).toBeInTheDocument();
    expect(screen.getByText("Updates automatically")).toBeInTheDocument();
    expect(screen.getByText("Verified with Anthropic's release signature and checksum")).toBeInTheDocument();
    expect(screen.getByText("No administrator rights required")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Stable (recommended)" })).toBeChecked();
  });

  it("shows a loading state while the plan is resolved", async () => {
    fakeNative().claudeInstallPlan.mockReturnValue(new Promise(() => {}));
    await openConsent();

    expect(screen.getByRole("status")).toHaveTextContent("Loading install details…");
    expect(screen.getByRole("button", { name: "Install" })).toHaveAttribute("aria-disabled", "true");
  });

  it("switches the release channel", async () => {
    const { user } = await openConsent();
    await screen.findByText("2.1.285");

    await user.click(screen.getByRole("radio", { name: "Latest" }));

    expect(await screen.findByText("2.2.0")).toBeInTheDocument();
    expect(screen.getByText("105.0 MB")).toBeInTheDocument();
    expect(fakeNative().claudeInstallPlan).toHaveBeenLastCalledWith("latest");

    await user.click(screen.getByRole("button", { name: "Install" }));
    expect((await waitForInstall()).channel).toBe("latest");
  });

  it("explains a plan error and retries", async () => {
    fakeNative().fail("claudeInstallPlan", "dns error", "network");
    const { user } = await openConsent();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Check your internet connection and proxy settings/);
    await user.click(screen.getByRole("button", { name: "Install" }));
    expect(fakeNative().claudeInstallStart).not.toHaveBeenCalled();

    fakeNative().recover("claudeInstallPlan");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("2.1.285")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes with Cancel and with Escape", async () => {
    const { user } = await openConsent();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await heading("Claude Code not found")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Install Claude Code" }));
    await heading("Install Claude Code");
    await user.keyboard("{Escape}");
    expect(await heading("Claude Code not found")).toHaveFocus();
    expect(fakeNative().claudeInstallStart).not.toHaveBeenCalled();
  });

  it("does not install over an existing Claude Code", async () => {
    const existing = {
      path: "C:\\Users\\dev\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe",
      version: "2.0.1",
      source: "package",
    } as const;
    fakeNative().installPlans.stable = fixtures.installPlan("stable", { alreadyInstalled: existing });
    const { user } = await renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Install Claude Code" }));

    expect(await heading("Claude Code is already installed")).toHaveFocus();
    expect(screen.getByText(existing.path)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();

    fakeNative().status = { ...fixtures.signedOutStatus(), install: existing };
    await user.click(screen.getByRole("button", { name: "Check again" }));

    expect(await heading("Sign in with your Claude subscription")).toBeInTheDocument();
    expect(fakeNative().claudeInstallStart).not.toHaveBeenCalled();
  });
});

describe("Install Claude Code — progress", () => {
  it("shows each phase and the download progress, then continues to sign-in", async () => {
    const { install } = await startInstall();
    const steps = screen.getByRole("list", { name: "Installation steps" });

    expect(phaseAnnouncement()).toHaveTextContent("Checking the latest version");
    expect(within(steps).getByRole("listitem", { current: "step" })).toHaveTextContent("Checking the latest version");
    expect(progressbar()).toHaveAttribute("aria-valuenow", "0");
    expect(progressbar()).toHaveAttribute("aria-valuemax", "100");

    install.phase("verifying_manifest");
    await waitFor(() => expect(phaseAnnouncement()).toHaveTextContent("Verifying Anthropic's signature"));

    install.phase("downloading");
    install.progress(26_214_400, 104_857_600);
    await waitFor(() => expect(progressbar()).toHaveAttribute("aria-valuenow", "25"));
    expect(phaseAnnouncement()).toHaveTextContent("Downloading");
    expect(progressbar()).toHaveAttribute("aria-valuetext", "25%, 25.0 MB of 100.0 MB");
    expect(screen.getByText("25.0 MB of 100.0 MB")).toBeInTheDocument();
    // Progress ticks do not touch the live region.
    expect(phaseAnnouncement()).toHaveTextContent(/^Downloading$/);

    install.progress(104_857_600, 104_857_600);
    install.phase("verifying_binary");
    await waitFor(() => expect(phaseAnnouncement()).toHaveTextContent("Verifying the download"));
    expect(progressbar()).toHaveAttribute("aria-valuenow", "100");
    expect(within(steps).getAllByRole("listitem")[2]).toHaveTextContent("Downloading(done)");
    expect(within(steps).getByRole("listitem", { current: "step" })).toHaveTextContent("Verifying the download");

    install.phase("installing");
    await waitFor(() => expect(phaseAnnouncement()).toHaveTextContent("Installing"));
    install.phase("checking");
    await waitFor(() => expect(phaseAnnouncement()).toHaveTextContent("Checking the installation"));

    install.done({ ...fixtures.INSTALL, version: "2.1.285" });

    // Success, then the status is re-checked and the gate moves on to sign-in by itself.
    expect(await heading("Sign in with your Claude subscription")).toHaveFocus();
    expect(fakeNative().claudeStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("briefly confirms the installed version", async () => {
    const { install } = await startInstall();
    fakeNative().claudeStatus.mockReturnValue(new Promise(() => {})); // keep the re-check pending

    install.done({ ...fixtures.INSTALL, version: "2.1.285" });

    expect(await heading("Claude Code 2.1.285 installed")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Continuing to sign-in…");
  });

  it("cancels the install", async () => {
    const { user, install } = await startInstall();
    install.phase("downloading");
    await waitFor(() => expect(phaseAnnouncement()).toHaveTextContent("Downloading"));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fakeNative().claudeInstallCancel).toHaveBeenCalledWith("install-1");
    expect(await heading("Installation cancelled")).toHaveFocus();
    expect(screen.getByText(/Claude Code was not installed/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Install Claude Code" }));
    expect(await heading("Install Claude Code")).toBeInTheDocument();
  });

  it("keeps focus on Cancel while the installer stops", async () => {
    fakeNative().cancelInstallOnRequest = false;
    const { user, install } = await startInstall();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const cancelling = await screen.findByRole("button", { name: "Cancelling…" });
    expect(cancelling).toHaveFocus();
    expect(cancelling).toHaveAttribute("aria-disabled", "true");

    install.emit({ type: "cancelled" });
    expect(await heading("Installation cancelled")).toHaveFocus();
  });
});

describe("Install Claude Code — errors", () => {
  it.each([
    ["network", "Could not download Claude Code", /Check your internet connection and proxy settings/],
    ["unexpected_response", "Could not download Claude Code", /not be available in your region, or a proxy/],
    ["signature_invalid", "Download could not be verified", /Nothing was installed/],
    ["checksum_mismatch", "Download could not be verified", /does not match the checksum.*Nothing was installed/],
    ["publisher_untrusted", "Download could not be verified", /not signed by Anthropic.*Nothing was installed/],
    ["disk_full", "Not enough disk space", /Free up some space/],
    ["install_failed", "Claude Code could not be installed", /installer reported an error/],
    ["busy", "An installation is already running", /Wait for it to finish/],
    ["something_new", "Claude Code could not be installed", /Something went wrong/],
  ])("explains %s", async (code, title, message) => {
    const { install } = await startInstall();

    install.fail(code, `raw ${code} detail`);

    expect(await heading(title)).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("explains an unsupported platform without offering to retry", async () => {
    const { install } = await startInstall();

    install.fail("unsupported_platform", "linux-riscv64");

    expect(await heading("This computer is not supported")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    // Other ways to install are shown right away.
    expect(screen.getByText("irm https://claude.ai/install.ps1 | iex")).toBeVisible();
  });

  it("shows the installer output on request and retries", async () => {
    const { user, install } = await startInstall();
    install.fail("install_failed", "claude install exited with code 1: EPERM");
    await heading("Claude Code could not be installed");

    expect(screen.queryByText(/EPERM/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("install_failed: claude install exited with code 1: EPERM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await heading("Installing Claude Code")).toHaveFocus();
    expect(fakeNative().claudeInstallStart).toHaveBeenCalledTimes(2);
  });

  it("reports an install that is already running elsewhere", async () => {
    fakeNative().fail("claudeInstallStart", "An install is already running", "busy");
    const { user } = await openConsent();
    await screen.findByText("2.1.285");

    await user.click(screen.getByRole("button", { name: "Install" }));

    expect(await heading("An installation is already running")).toBeInTheDocument();
  });
});

describe("Install Claude Code — other ways to install", () => {
  it.each([
    [
      WINDOWS_UA,
      "Install on Windows",
      ["irm https://claude.ai/install.ps1 | iex", "winget install Anthropic.ClaudeCode"],
      ["PowerShell", "WinGet"],
    ],
    [
      MAC_UA,
      "Install on macOS",
      ["curl -fsSL https://claude.ai/install.sh | bash", "brew install --cask claude-code"],
      ["Terminal", "Homebrew"],
    ],
    [LINUX_UA, "Install on Linux", ["curl -fsSL https://claude.ai/install.sh | bash"], ["Terminal"]],
  ])("lists the official commands for the detected OS (%#)", async (userAgent, title, commands, labels) => {
    setUserAgent(userAgent);
    const { user } = await renderApp("/");
    await heading("Claude Code not found");

    const toggle = screen.getByRole("button", { name: "Other ways to install" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByText(title)).toBeInTheDocument();
    for (const command of commands) expect(screen.getByText(command)).toBeInTheDocument();
    for (const label of labels) {
      expect(screen.getByRole("button", { name: `Copy ${label} install command` })).toBeInTheDocument();
    }
    expect(screen.getByText("https://code.claude.com/docs/en/setup")).toBeInTheDocument();
    expect(screen.getByText(/then click Check again/)).toBeInTheDocument();
  });

  it("copies a command to the clipboard", async () => {
    const { user } = await renderApp("/");
    await heading("Claude Code not found");
    await user.click(screen.getByRole("button", { name: "Other ways to install" }));

    await user.click(screen.getByRole("button", { name: "Copy WinGet install command" }));

    expect(await navigator.clipboard.readText()).toBe("winget install Anthropic.ClaudeCode");
    expect(screen.getByRole("button", { name: "WinGet install command copied" })).toBeInTheDocument();
  });

  it("prefers the platform reported by the installer plan", async () => {
    fakeNative().installPlans.stable = fixtures.installPlan("stable", { platform: "darwin-arm64" });
    fakeNative().fail("claudeInstallStart", "boom", "install_failed");
    const { user } = await openConsent();
    await screen.findByText("2.1.285");
    await user.click(screen.getByRole("button", { name: "Install" }));
    await heading("Claude Code could not be installed");

    await user.click(screen.getByRole("button", { name: "Other ways to install" }));

    expect(screen.getByText("Install on macOS")).toBeInTheDocument();
  });
});

describe("detectOs", () => {
  it("reads client hints, platform and user agent", () => {
    expect(
      detectOs({ userAgentData: { platform: "macOS" }, platform: "", userAgent: "" } as unknown as Navigator),
    ).toBe("macos");
    expect(detectOs({ platform: "Win32", userAgent: "" } as Navigator)).toBe("windows");
    expect(detectOs({ platform: "Linux x86_64", userAgent: "" } as Navigator)).toBe("linux");
    expect(detectOs({ platform: "", userAgent: "" } as Navigator)).toBeUndefined();
  });
});
