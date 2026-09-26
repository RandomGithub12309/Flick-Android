import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { i as string, r as object } from "../_libs/zod.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { n as create, t as persist } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/load-saved-CgdfsoWT.js
function cn(...parts) {
	return twMerge(...parts.filter((p) => Boolean(p)));
}
function shuffleInPlace(items) {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const current = items[i];
		const swap = items[j];
		if (current === void 0 || swap === void 0) continue;
		items[i] = swap;
		items[j] = current;
	}
	return items;
}
function formatScore(n) {
	const abs = Math.abs(n);
	if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}m`;
	if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
	return String(n);
}
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var creds = object({
	clientId: string().min(2),
	clientSecret: string().min(2)
});
var redditPasswordLogin = createServerFn({ method: "POST" }).validator(object({
	username: string().min(1),
	password: string().min(1),
	clientId: string().min(2),
	clientSecret: string().min(2)
})).handler(createSsrRpc("203cfc3a010524f9a787ab8af81fa23d09e493efbf5b35a0e1eaca312705fa6a"));
var redditExchangeCode = createServerFn({ method: "POST" }).validator(creds.extend({
	code: string().min(1),
	redirectUri: string().url()
})).handler(createSsrRpc("02052af0d049383b816a07735bb14950f5e5f82d20d34b28e720fb0e2bcfb71e"));
var redditRefresh = createServerFn({ method: "POST" }).validator(creds.extend({ refreshToken: string().min(1) })).handler(createSsrRpc("4b65b2cda2e819c297376d6345cb97efaee40c2dccbc34536542024c8fe8f9f2"));
var redditSavedPage = createServerFn({ method: "POST" }).validator(object({
	accessToken: string().min(8),
	username: string().min(1),
	after: string().nullable().optional()
})).handler(createSsrRpc("34d111859f6394c91d3f119694f8f6b79e7bda33c754b790250d34622c5a87df"));
var redditDemoFeed = createServerFn({ method: "POST" }).handler(createSsrRpc("b1b0f8b38b4f900c74988a8b863c9a54686864cd9ba44d1f27d892a1476fd216"));
var useFlick = create()(persist((set, get) => ({
	hydrated: false,
	ageOk: false,
	screen: "home",
	source: "demo",
	session: null,
	posts: [],
	index: 0,
	muted: false,
	loadingLabel: "",
	loadingCount: 0,
	error: null,
	setHydrated: () => set({ hydrated: true }),
	acceptAge: () => set({ ageOk: true }),
	setScreen: (screen) => set({
		screen,
		error: null
	}),
	setSession: (session) => set({ session }),
	setError: (error) => set({ error }),
	setLoading: (label, count = 0) => set({
		screen: "loading",
		loadingLabel: label,
		loadingCount: count,
		error: null
	}),
	setPosts: (posts, source) => {
		const shuffled = shuffleInPlace([...posts]);
		set({
			posts: shuffled,
			source,
			index: 0,
			screen: shuffled.length > 0 ? "feed" : "home",
			error: shuffled.length === 0 ? "No posts to play. Save something on Reddit, then try again." : null
		});
	},
	setIndex: (index) => {
		const { posts } = get();
		if (posts.length === 0) return;
		set({ index: (index % posts.length + posts.length) % posts.length });
	},
	next: () => {
		const { index, posts } = get();
		if (posts.length === 0) return;
		set({ index: (index + 1) % posts.length });
	},
	prev: () => {
		const { index, posts } = get();
		if (posts.length === 0) return;
		set({ index: (index - 1 + posts.length) % posts.length });
	},
	reroll: () => {
		const { posts, index } = get();
		if (posts.length < 2) return;
		let next = Math.floor(Math.random() * posts.length);
		if (next === index) next = (next + 1) % posts.length;
		set({ index: next });
	},
	toggleMuted: () => set({ muted: !get().muted }),
	signOut: () => set({
		session: null,
		posts: [],
		index: 0,
		screen: "home",
		source: "demo",
		error: null
	})
}), {
	name: "flick.v1",
	partialize: (state) => ({
		ageOk: state.ageOk,
		session: state.session,
		muted: state.muted
	}),
	onRehydrateStorage: () => (state) => {
		state?.setHydrated();
	}
}));
async function ensureFreshSession(session) {
	if (session.expiresAt > Date.now() + 15e3) return session;
	if (!session.refreshToken) throw new Error("Reddit session expired. Sign in again.");
	const next = await redditRefresh({ data: {
		refreshToken: session.refreshToken,
		clientId: session.clientId,
		clientSecret: session.clientSecret
	} });
	const updated = {
		username: next.username || session.username,
		accessToken: next.accessToken,
		refreshToken: next.refreshToken ?? session.refreshToken,
		expiresAt: next.expiresAt,
		clientId: session.clientId,
		clientSecret: session.clientSecret
	};
	useFlick.getState().setSession(updated);
	return updated;
}
async function loadAllSaved(session) {
	const store = useFlick.getState();
	store.setLoading("Pulling your saved posts…", 0);
	const current = await ensureFreshSession(session);
	const all = [];
	let after = null;
	for (let page = 0; page < 10; page++) {
		const result = await redditSavedPage({ data: {
			accessToken: current.accessToken,
			username: current.username,
			after: after ?? null
		} });
		all.push(...result.posts);
		store.setLoading(`Loaded ${all.length} saved posts…`, all.length);
		after = result.after;
		if (!after || result.posts.length === 0) break;
	}
	return all;
}
//#endregion
export { redditExchangeCode as a, useFlick as c, redditDemoFeed as i, formatScore as n, redditPasswordLogin as o, loadAllSaved as r, shuffleInPlace as s, cn as t };
