import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

const REPO = "RandomGithub12309/Flick-Android";

export type AppUpdateInfo = {
  versionName: string;
  versionCode: number;
  downloadUrl: string;
};

/**
 * Checks the rolling `latest` GitHub Release against the installed APK's
 * `versionCode`. Returns update metadata if a newer build is available, or
 * null otherwise.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const info = await CapacitorApp.getInfo();
    const currentCode = Number(info.build) || 0;
    if (currentCode <= 0) return null;

    const res = await CapacitorHttp.request({
      url: `https://api.github.com/repos/${REPO}/releases/tags/latest`,
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Flick-Android",
      },
      connectTimeout: 6000,
      readTimeout: 6000,
    });
    if (res.status < 200 || res.status >= 300) return null;

    const json = (typeof res.data === "string" ? JSON.parse(res.data) : res.data) as {
      name?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };

    const match = json.body?.match(/versionCode:\s*(\d+)/i);
    const remoteCode = match ? Number(match[1]) : 0;
    if (!remoteCode || remoteCode <= currentCode) return null;

    const apk = json.assets?.find((a) => a.name?.endsWith(".apk") && a.browser_download_url);
    if (!apk?.browser_download_url) return null;

    return {
      versionName: json.name?.replace(/^Flick Android\s*\(?|\)?$/g, "") || `1.0.${remoteCode}`,
      versionCode: remoteCode,
      downloadUrl: apk.browser_download_url,
    };
  } catch {
    return null;
  }
}

export async function openUpdateDownload(url: string): Promise<void> {
  await Browser.open({ url });
}
