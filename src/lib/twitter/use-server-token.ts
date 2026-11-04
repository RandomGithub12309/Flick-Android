import { useEffect, useState } from "react";
import { twitterStatus } from "./functions";

/**
 * Whether the deployment carries `X_BEARER_TOKEN`.
 *
 * The form needs to know, or it would ask for a token that is already there and
 * never explain why a handle alone works. Kept out of the component file so
 * that one stays components-only (Fast Refresh).
 */
export function useServerToken(): boolean {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void twitterStatus()
      .then((value) => {
        if (!cancelled) setConfigured(value);
      })
      .catch(() => {
        // A deploy without the route wired up yet just means "no token here".
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return configured === true;
}
