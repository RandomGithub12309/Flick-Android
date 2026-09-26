import { i as __toESM } from "../_runtime.mjs";
import { b as require_jsx_runtime, q as require_react } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as redditExchangeCode, c as useFlick, r as loadAllSaved, s as shuffleInPlace } from "./load-saved-CgdfsoWT.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/oauth-C98k1TEs.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function OauthPage() {
	const [status, setStatus] = (0, import_react.useState)("Connecting to Reddit…");
	(0, import_react.useEffect)(() => {
		const params = new URLSearchParams(window.location.search);
		const error = params.get("error");
		const code = params.get("code");
		const state = params.get("state") ?? "";
		if (error) {
			setStatus("Reddit denied access.");
			return;
		}
		if (!code) {
			setStatus("Missing OAuth code.");
			return;
		}
		if (window.opener) {
			window.opener.postMessage({
				type: "flick-oauth",
				code,
				state
			}, window.location.origin);
			setStatus("Signed in. You can close this window.");
			window.setTimeout(() => window.close(), 400);
			return;
		}
		completeInPlace(code, state, setStatus);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-xs font-medium uppercase tracking-[0.22em] text-muted",
			children: "Flick"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-4 text-lg text-fg",
			children: status
		})]
	});
}
async function completeInPlace(code, state, setStatus) {
	const raw = sessionStorage.getItem("flick.oauth");
	if (!raw) {
		setStatus("Session expired. Close this and tap Sign in again.");
		return;
	}
	const saved = JSON.parse(raw);
	if (saved.state !== state) {
		setStatus("OAuth state mismatch.");
		return;
	}
	try {
		const tokens = await redditExchangeCode({ data: {
			code,
			redirectUri: saved.redirectUri,
			clientId: saved.clientId,
			clientSecret: saved.clientSecret
		} });
		const session = {
			username: tokens.username,
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			expiresAt: tokens.expiresAt,
			clientId: saved.clientId,
			clientSecret: saved.clientSecret
		};
		useFlick.getState().setSession(session);
		setStatus("Pulling your saved posts…");
		const posts = await loadAllSaved(session);
		useFlick.getState().setPosts(shuffleInPlace(posts), "saved");
		sessionStorage.removeItem("flick.oauth");
		window.location.replace("/");
	} catch (err) {
		setStatus(err instanceof Error ? err.message : "OAuth failed.");
	}
}
//#endregion
export { OauthPage as component };
