import { execSync } from "node:child_process";
import { platform } from "node:os";

export type NotificationOptions = {
  title: string;
  message: string;
  sound?: boolean;
  subtitle?: string;
};

function isCI(): boolean {
  return !!(process.env.CI || process.env.CONTINUOUS_INTEGRATION || process.env.BUILD_ID);
}

function isTTY(): boolean {
  return !!process.stdout.isTTY;
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || !!process.env.VITEST;
}

function notificationsDisabled(): boolean {
  const raw = process.env.LINEUP_DISABLE_NOTIFICATIONS;
  if (!raw) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function sendNotification(options: NotificationOptions): void {
  if (isCI() || isTestEnv() || notificationsDisabled() || !isTTY()) return;

  const os = platform();

  try {
    if (os === "darwin") {
      sendMacNotification(options);
    } else if (os === "linux") {
      sendLinuxNotification(options);
    }
    // Windows: not supported yet
  } catch {
    // Notifications are best-effort; never fail the pipeline
  }
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sendMacNotification(options: NotificationOptions): void {
  const title = escapeAppleScript(options.title);
  const message = escapeAppleScript(options.message);
  const subtitle = options.subtitle ? ` subtitle "${escapeAppleScript(options.subtitle)}"` : "";
  const sound = options.sound !== false ? ' sound name "Glass"' : "";

  execSync(
    `osascript -e 'display notification "${message}" with title "${title}"${subtitle}${sound}'`,
    { stdio: "ignore", timeout: 5000 }
  );
}

function sendLinuxNotification(options: NotificationOptions): void {
  const title = options.title.replace(/'/g, "'\\''");
  const message = options.message.replace(/'/g, "'\\''");

  execSync(`notify-send '${title}' '${message}'`, {
    stdio: "ignore",
    timeout: 5000
  });
}

export function notifyPipelineComplete(runId: string, status: string, summary?: string): void {
  const isSuccess = status === "success" || status === "succeeded";
  const title = isSuccess ? "Lineup: Pipeline Succeeded" : "Lineup: Pipeline Failed";
  const message = summary ?? `Run ${runId} finished with status: ${status}`;

  sendNotification({
    title,
    message,
    subtitle: `Run ${runId}`,
    sound: true,
  });
}
