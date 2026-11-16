import { Capacitor, registerPlugin } from "@capacitor/core";

export type TwitterAuthLoginResult = {
  authToken: string;
  ct0: string;
  screenName?: string;
};

export type TwitterWebViewFetchResult = {
  status: number;
  body: string;
  error?: string;
};

interface TwitterAuthPlugin {
  login(): Promise<TwitterAuthLoginResult>;
  logout(): Promise<void>;
  graphqlFetch(options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<TwitterWebViewFetchResult>;
}

const TwitterAuth = registerPlugin<TwitterAuthPlugin>("TwitterAuth");

export function isNativeTwitterAuthSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export async function loginTwitterNative(): Promise<TwitterAuthLoginResult> {
  return TwitterAuth.login();
}

export async function logoutTwitterNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await TwitterAuth.logout().catch(() => {});
}

export async function fetchViaTwitterWebView(options: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<TwitterWebViewFetchResult> {
  return TwitterAuth.graphqlFetch(options);
}
