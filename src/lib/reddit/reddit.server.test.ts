import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { exchangeCode, refreshGrant } from "./reddit.server.ts";

/**
 * Flick is a Reddit **installed app**: a public client issued with no client
 * secret. That is a real protocol contract, not a style preference — Reddit
 * issues a secret to "script"/"web app" registrations and rejects a bare
 * client id against those. These tests pin the installed-app wire format so a
 * future change can't quietly turn Flick into a script app (which would also
 * mean shipping a secret inside a client-side app).
 *
 * `fetch` is stubbed, so nothing here touches reddit.com.
 */

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const realFetch = globalThis.fetch;

type Recorded = { url: string; init: RequestInit };

let calls: Recorded[] = [];

function decodeBasic(header: string): { user: string; password: string } {
  const raw = header.replace(/^Basic\s+/i, "");
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  return { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

function stub(routes: Array<[RegExp, () => Response]>) {
  calls = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [match, respond] of routes) {
      if (match.test(url)) return respond();
    }
    throw new Error(`unstubbed request: ${url}`);
  }) as typeof fetch;
}

const tokenResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
});

describe("reddit token exchange — installed app contract", () => {
  it("authenticates as the client id with an EMPTY password (no secret)", async () => {
    stub([
      [
        /access_token/,
        () => tokenResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      ],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    await exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "myClientId" });

    const token = calls.find((c) => c.url === TOKEN_URL);
    assert.ok(token, "token endpoint was called");
    const auth = decodeBasic((token.init.headers as Record<string, string>).Authorization);
    assert.equal(auth.user, "myClientId", "client id is the Basic username");
    assert.equal(auth.password, "", "installed apps send NO client secret");
  });

  it("never puts a client_secret in the request body", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    await exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" });

    const token = calls.find((c) => c.url === TOKEN_URL)!;
    const body = String(token.init.body);
    assert.ok(!body.includes("client_secret"), `body leaked a secret: ${body}`);
    assert.ok(!body.includes("secret"), `body mentioned a secret: ${body}`);
  });

  it("uses the authorization_code grant and echoes the registered redirect_uri", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    await exchangeCode({ code: "the-code", redirectUri: "flick://oauth", clientId: "id" });

    const params = new URLSearchParams(String(calls[0].init.body));
    assert.equal(params.get("grant_type"), "authorization_code");
    assert.equal(params.get("code"), "the-code");
    // Reddit rejects the exchange if this differs from the authorize request.
    assert.equal(params.get("redirect_uri"), "flick://oauth");
  });

  it("sends a descriptive User-Agent, which Reddit requires", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    await exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" });

    const headers = calls[0].init.headers as Record<string, string>;
    assert.match(headers["User-Agent"], /app\.flick\.saved/);
  });

  it("refreshes with the refresh_token grant and still sends no secret", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at2", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    const bundle = await refreshGrant({ refreshToken: "rt", clientId: "myClientId" });

    const token = calls.find((c) => c.url === TOKEN_URL)!;
    const params = new URLSearchParams(String(token.init.body));
    assert.equal(params.get("grant_type"), "refresh_token");
    assert.equal(params.get("refresh_token"), "rt");
    assert.ok(!params.has("client_secret"));
    assert.equal(
      decodeBasic((token.init.headers as Record<string, string>).Authorization).password,
      "",
    );
    assert.equal(bundle.accessToken, "at2");
  });

  it("resolves the username over oauth.reddit.com with a bearer token", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    const bundle = await exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" });
    assert.equal(bundle.username, "someone");

    const me = calls.find((c) => c.url.includes("/api/v1/me"))!;
    const headers = me.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer at");
  });
});

describe("reddit errors point at the installed-app requirement", () => {
  it("explains a rejected client id as an app-type problem, not a bad id", async () => {
    stub([[/access_token/, () => tokenResponse({ error: "invalid_client" }, 401)]]);

    await assert.rejects(
      () => exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" }),
      (err: Error) => {
        assert.match(err.message, /installed app/);
        assert.match(err.message, /never asks for a client secret/);
        assert.doesNotMatch(err.message, /username or password/);
        return true;
      },
    );
  });

  it("tells a reused/expired code to authorize again", async () => {
    stub([[/access_token/, () => tokenResponse({ error: "invalid_grant" }, 400)]]);

    await assert.rejects(
      () => exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" }),
      (err: Error) => {
        assert.match(err.message, /Authorize again/);
        assert.doesNotMatch(err.message, /username or password/);
        return true;
      },
    );
  });

  it("fails loudly when Reddit returns no access token", async () => {
    stub([[/access_token/, () => tokenResponse({ token_type: "bearer" }, 200)]]);

    await assert.rejects(
      () => exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" }),
      /did not return an access token/,
    );
  });
});
