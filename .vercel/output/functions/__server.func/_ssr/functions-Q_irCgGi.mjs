import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "./ssr.mjs";
import { i as string, r as object } from "../_libs/zod.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/functions-Q_irCgGi.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var creds = object({
	clientId: string().min(2),
	clientSecret: string().min(2)
});
var redditPasswordLogin_createServerFn_handler = createServerRpc({
	id: "203cfc3a010524f9a787ab8af81fa23d09e493efbf5b35a0e1eaca312705fa6a",
	name: "redditPasswordLogin",
	filename: "src/lib/reddit/functions.ts"
}, (opts) => redditPasswordLogin.__executeServer(opts));
var redditPasswordLogin = createServerFn({ method: "POST" }).validator(object({
	username: string().min(1),
	password: string().min(1),
	clientId: string().min(2),
	clientSecret: string().min(2)
})).handler(redditPasswordLogin_createServerFn_handler, async ({ data }) => {
	const { passwordGrant } = await import("./reddit.server-BXYwQzNi.mjs");
	return passwordGrant({
		username: data.username.trim().replace(/^\/?u\//, ""),
		password: data.password,
		clientId: data.clientId.trim(),
		clientSecret: data.clientSecret.trim()
	});
});
var redditExchangeCode_createServerFn_handler = createServerRpc({
	id: "02052af0d049383b816a07735bb14950f5e5f82d20d34b28e720fb0e2bcfb71e",
	name: "redditExchangeCode",
	filename: "src/lib/reddit/functions.ts"
}, (opts) => redditExchangeCode.__executeServer(opts));
var redditExchangeCode = createServerFn({ method: "POST" }).validator(creds.extend({
	code: string().min(1),
	redirectUri: string().url()
})).handler(redditExchangeCode_createServerFn_handler, async ({ data }) => {
	const { exchangeCode } = await import("./reddit.server-BXYwQzNi.mjs");
	return exchangeCode({
		code: data.code,
		redirectUri: data.redirectUri,
		clientId: data.clientId.trim(),
		clientSecret: data.clientSecret.trim()
	});
});
var redditRefresh_createServerFn_handler = createServerRpc({
	id: "4b65b2cda2e819c297376d6345cb97efaee40c2dccbc34536542024c8fe8f9f2",
	name: "redditRefresh",
	filename: "src/lib/reddit/functions.ts"
}, (opts) => redditRefresh.__executeServer(opts));
var redditRefresh = createServerFn({ method: "POST" }).validator(creds.extend({ refreshToken: string().min(1) })).handler(redditRefresh_createServerFn_handler, async ({ data }) => {
	const { refreshGrant } = await import("./reddit.server-BXYwQzNi.mjs");
	return refreshGrant({
		refreshToken: data.refreshToken,
		clientId: data.clientId.trim(),
		clientSecret: data.clientSecret.trim()
	});
});
var redditSavedPage_createServerFn_handler = createServerRpc({
	id: "34d111859f6394c91d3f119694f8f6b79e7bda33c754b790250d34622c5a87df",
	name: "redditSavedPage",
	filename: "src/lib/reddit/functions.ts"
}, (opts) => redditSavedPage.__executeServer(opts));
var redditSavedPage = createServerFn({ method: "POST" }).validator(object({
	accessToken: string().min(8),
	username: string().min(1),
	after: string().nullable().optional()
})).handler(redditSavedPage_createServerFn_handler, async ({ data }) => {
	const { fetchSavedPage } = await import("./reddit.server-BXYwQzNi.mjs");
	return fetchSavedPage({
		accessToken: data.accessToken,
		username: data.username,
		after: data.after
	});
});
var redditDemoFeed_createServerFn_handler = createServerRpc({
	id: "b1b0f8b38b4f900c74988a8b863c9a54686864cd9ba44d1f27d892a1476fd216",
	name: "redditDemoFeed",
	filename: "src/lib/reddit/functions.ts"
}, (opts) => redditDemoFeed.__executeServer(opts));
var redditDemoFeed = createServerFn({ method: "POST" }).handler(redditDemoFeed_createServerFn_handler, async () => {
	const { fetchDemoFeed } = await import("./reddit.server-BXYwQzNi.mjs");
	return fetchDemoFeed();
});
//#endregion
export { redditDemoFeed_createServerFn_handler, redditExchangeCode_createServerFn_handler, redditPasswordLogin_createServerFn_handler, redditRefresh_createServerFn_handler, redditSavedPage_createServerFn_handler };
