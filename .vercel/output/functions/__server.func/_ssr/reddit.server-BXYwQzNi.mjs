//#region node_modules/.nitro/vite/services/ssr/assets/reddit.server-BXYwQzNi.js
var MINOR_PATTERN = /\b(loli|shota|child porn|preteen|pre-teen|underage|under.?18|jailbait)\b/i;
function asRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value;
}
function asString(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function asNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function asBool(value) {
	return value === true;
}
function decodeUrl(url) {
	return url.replaceAll("&", "&");
}
function redditAudioUrl(fallback) {
	const decoded = decodeUrl(fallback);
	if (/CMAF_\d+\.mp4/i.test(decoded)) return decoded.replace(/CMAF_\d+\.mp4/i, "CMAF_AUDIO_128.mp4");
	if (/DASH_\d+[._]?\d*\.mp4/i.test(decoded)) return decoded.replace(/DASH_\d+[._]?\d*\.mp4/i, "DASH_AUDIO_128.mp4");
	const id = decoded.match(/v\.redd\.it\/([^/?#]+)/)?.[1];
	if (id) return `https://v.redd.it/${id}/CMAF_AUDIO_128.mp4`;
}
function redditVideoFromMedia(media) {
	const rv = asRecord(asRecord(media)?.reddit_video);
	if (!rv) return void 0;
	const fallback = asString(rv.fallback_url);
	if (!fallback) return void 0;
	const width = asNumber(rv.width) ?? 720;
	const height = asNumber(rv.height) ?? 1280;
	const hasAudio = asBool(rv.has_audio) && !asBool(rv.is_gif);
	return {
		url: decodeUrl(fallback),
		audioUrl: hasAudio ? redditAudioUrl(fallback) : void 0,
		width,
		height,
		duration: asNumber(rv.duration),
		hasAudio
	};
}
function largestPreview(data) {
	const images = asRecord(data.preview)?.images;
	if (!Array.isArray(images) || images.length === 0) return void 0;
	const source = asRecord(asRecord(images[0])?.source);
	const url = asString(source?.url);
	if (!url) return void 0;
	return {
		url: decodeUrl(url),
		width: asNumber(source?.width),
		height: asNumber(source?.height)
	};
}
function galleryImages(data) {
	if (!asBool(data.is_gallery)) return void 0;
	const meta = asRecord(data.media_metadata);
	const items = asRecord(data.gallery_data)?.items;
	if (!meta) return void 0;
	const order = [];
	if (Array.isArray(items)) for (const item of items) {
		const id = asString(asRecord(item)?.media_id);
		if (id) order.push(id);
	}
	else order.push(...Object.keys(meta));
	const images = [];
	for (const id of order) {
		const entry = asRecord(meta[id]);
		if (!entry || asString(entry.status) === "failed") continue;
		const s = asRecord(entry.s);
		const url = asString(s?.u) ?? asString(s?.gif) ?? asString(s?.mp4);
		if (!url) continue;
		images.push({
			url: decodeUrl(url),
			width: asNumber(s?.x),
			height: asNumber(s?.y)
		});
	}
	return images.length > 0 ? images : void 0;
}
function isUnsafeMinorContent(title, subreddit) {
	return MINOR_PATTERN.test(title) || MINOR_PATTERN.test(subreddit);
}
function imgurVideoUrl(url) {
	if (/i\.imgur\.com\/.+\.gifv$/i.test(url)) return url.replace(/\.gifv$/i, ".mp4");
	if (/i\.imgur\.com\/.+\.gif$/i.test(url)) return url.replace(/\.gif$/i, ".mp4");
}
function previewRedditVideo(data) {
	const preview = asRecord(data.preview);
	if (!preview?.reddit_video_preview) return void 0;
	return redditVideoFromMedia({ reddit_video: preview.reddit_video_preview });
}
function parseRedditPost(raw) {
	const listing = asRecord(raw);
	const data = asRecord(listing?.data) ?? listing;
	if (!data) return null;
	const name = asString(data.name) ?? "";
	if (name.startsWith("t1_")) return null;
	const id = asString(data.id);
	const title = asString(data.title) ?? "";
	const subreddit = asString(data.subreddit) ?? "";
	const author = asString(data.author) ?? "[deleted]";
	if (!id || !title) return null;
	if (isUnsafeMinorContent(title, subreddit)) return null;
	const permalinkPath = asString(data.permalink) ?? `/comments/${id}`;
	const permalink = permalinkPath.startsWith("http") ? permalinkPath : `https://www.reddit.com${permalinkPath}`;
	const cross = data.crosspost_parent_list;
	const sourceData = Array.isArray(cross) && cross.length > 0 ? asRecord(cross[0]) ?? data : data;
	const nsfw = asBool(data.over_18) || asBool(sourceData.over_18);
	const url = asString(sourceData.url_overridden_by_dest) ?? asString(sourceData.url) ?? "";
	const domain = asString(sourceData.domain);
	let video = redditVideoFromMedia(sourceData.secure_media ?? sourceData.media) ?? previewRedditVideo(sourceData);
	const imgurMp4 = url ? imgurVideoUrl(url) : void 0;
	if (!video && imgurMp4) video = {
		url: imgurMp4,
		width: 720,
		height: 1280,
		hasAudio: true
	};
	const gallery = galleryImages(sourceData);
	const previewImage = largestPreview(sourceData);
	const directImage = /\.(jpe?g|png|webp|gif)$/i.test(url) || /i\.redd\.it\//.test(url) ? { url: decodeUrl(url) } : void 0;
	const selftext = asString(data.selftext);
	const isSelf = asBool(data.is_self);
	let kind = "link";
	let image;
	if (video) kind = "video";
	else if (gallery && gallery.length > 0) {
		kind = "gallery";
		image = gallery[0];
	} else if (directImage) {
		kind = "image";
		image = directImage;
	} else if (previewImage) {
		kind = url && !isSelf ? "link" : "image";
		image = previewImage;
	} else if (isSelf || selftext && selftext.length > 0) kind = "text";
	else {
		kind = "link";
		image = previewImage;
	}
	const thumbRaw = asString(data.thumbnail);
	const thumbnail = thumbRaw && thumbRaw.startsWith("http") ? decodeUrl(thumbRaw) : image?.url;
	const post = {
		id,
		name: name || `t3_${id}`,
		title,
		subreddit,
		author,
		permalink,
		sourceUrl: url ? decodeUrl(url) : void 0,
		nsfw,
		score: asNumber(data.score) ?? 0,
		createdUtc: asNumber(data.created_utc) ?? 0,
		kind,
		video,
		image,
		gallery,
		text: selftext && selftext !== "[removed]" ? selftext : void 0,
		thumbnail,
		domain
	};
	if (kind === "link" && !post.image && !post.video && !post.text) return null;
	return post;
}
function parseListingChildren(raw) {
	const data = asRecord(asRecord(raw)?.data);
	const children = data?.children;
	const posts = [];
	if (Array.isArray(children)) for (const child of children) {
		const parsed = parseRedditPost(child);
		if (parsed) posts.push(parsed);
	}
	return {
		posts,
		after: asString(data?.after) ?? null
	};
}
function redgifsIdFromUrl(url) {
	return url.match(/redgifs\.com\/(?:watch|ifr)\/([a-zA-Z0-9]+)/i)?.[1];
}
var USER_AGENT = "android:app.flick.saved:1.0.0 (by /u/flick-player)";
var TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
var OAUTH = "https://oauth.reddit.com";
function basicAuth(clientId, clientSecret) {
	return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}
async function redditForm(clientId, clientSecret, body) {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			Authorization: basicAuth(clientId, clientSecret),
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": USER_AGENT
		},
		body
	});
	const json = await res.json().catch(() => null);
	if (!res.ok) {
		const msg = typeof json?.error === "string" && json.error || typeof json?.message === "string" && json.message || `Reddit token error (${res.status})`;
		throw new Error(humanRedditAuthError(msg));
	}
	return json ?? {};
}
function humanRedditAuthError(msg) {
	const key = msg.toLowerCase();
	if (key.includes("invalid_grant") || key.includes("wrong_password")) return "Reddit rejected that username or password. Accounts with two-factor auth need Authorize instead.";
	if (key.includes("401") || key.includes("unauthorized") || key.includes("invalid_client")) return "Reddit app ID or secret is wrong. Open reddit.com/prefs/apps and copy them again.";
	return `Reddit sign-in failed: ${msg}`;
}
function tokensFromJson(json, fallbackUser) {
	const accessToken = typeof json.access_token === "string" ? json.access_token : "";
	if (!accessToken) throw new Error("Reddit did not return an access token.");
	const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : null;
	const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
	return {
		accessToken,
		refreshToken,
		expiresAt: Date.now() + (expiresIn - 30) * 1e3,
		username: fallbackUser ?? ""
	};
}
async function passwordGrant(input) {
	const bundle = tokensFromJson(await redditForm(input.clientId, input.clientSecret, new URLSearchParams({
		grant_type: "password",
		username: input.username,
		password: input.password,
		scope: "identity history read"
	})), input.username.replace(/^\/?u\//, ""));
	if (!bundle.username) bundle.username = await fetchMe(bundle.accessToken);
	return bundle;
}
async function exchangeCode(input) {
	const bundle = tokensFromJson(await redditForm(input.clientId, input.clientSecret, new URLSearchParams({
		grant_type: "authorization_code",
		code: input.code,
		redirect_uri: input.redirectUri
	})));
	bundle.username = await fetchMe(bundle.accessToken);
	return bundle;
}
async function refreshGrant(input) {
	const bundle = tokensFromJson(await redditForm(input.clientId, input.clientSecret, new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: input.refreshToken
	})));
	if (!bundle.refreshToken) bundle.refreshToken = input.refreshToken;
	bundle.username = await fetchMe(bundle.accessToken);
	return bundle;
}
async function oauthGet(path, accessToken) {
	const res = await fetch(`${OAUTH}${path}`, { headers: {
		Authorization: `Bearer ${accessToken}`,
		"User-Agent": USER_AGENT,
		Cookie: "over18=1"
	} });
	if (res.status === 401) throw new Error("Reddit session expired. Sign in again.");
	if (!res.ok) throw new Error(`Reddit API ${res.status} on ${path.split("?")[0]}`);
	return res.json();
}
async function fetchMe(accessToken) {
	const json = await oauthGet("/api/v1/me", accessToken);
	const name = typeof json.name === "string" ? json.name : "";
	if (!name) throw new Error("Could not read your Reddit username.");
	return name;
}
async function fetchSavedPage(input) {
	const params = new URLSearchParams({
		limit: "100",
		raw_json: "1",
		type: "links",
		include_over_18: "1"
	});
	if (input.after) params.set("after", input.after);
	const parsed = parseListingChildren(await oauthGet(`/user/${encodeURIComponent(input.username.replace(/^\/?u\//, ""))}/saved?${params.toString()}`, input.accessToken));
	return {
		posts: await resolveExternalVideos(parsed.posts),
		after: parsed.after,
		username: input.username
	};
}
var redgifsAuth = null;
async function getRedgifsToken() {
	if (redgifsAuth && redgifsAuth.exp > Date.now() + 1e4) return redgifsAuth.token;
	try {
		const json = await (await fetch("https://api.redgifs.com/v2/auth/temporary", { headers: {
			Origin: "https://www.redgifs.com",
			Referer: "https://www.redgifs.com/",
			"User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36"
		} })).json();
		if (!json.token) return null;
		redgifsAuth = {
			token: json.token,
			exp: Date.now() + 216e5
		};
		return json.token;
	} catch {
		return null;
	}
}
async function resolveRedgifs(id) {
	const token = await getRedgifsToken();
	if (!token) return null;
	try {
		const res = await fetch(`https://api.redgifs.com/v2/gifs/${encodeURIComponent(id)}`, { headers: {
			Authorization: `Bearer ${token}`,
			Origin: "https://www.redgifs.com",
			Referer: `https://www.redgifs.com/watch/${id}`,
			"X-CustomHeader": `https://www.redgifs.com/watch/${id}`,
			"User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36"
		} });
		if (!res.ok) return null;
		const json = await res.json();
		const url = json.gif?.urls?.hd || json.gif?.urls?.sd;
		if (!url) return null;
		return {
			url,
			hasAudio: Boolean(json.gif?.hasAudio)
		};
	} catch {
		return null;
	}
}
function redgifsIdForPost(post) {
	const candidates = [
		post.sourceUrl,
		post.permalink,
		post.thumbnail,
		post.domain
	].filter((v) => Boolean(v));
	for (const c of candidates) {
		const id = redgifsIdFromUrl(c);
		if (id) return id;
	}
}
async function resolveExternalVideos(posts) {
	const out = [];
	for (const post of posts) {
		if (post.video) {
			out.push(post);
			continue;
		}
		const gifId = redgifsIdForPost(post);
		if (gifId) {
			const resolved = await resolveRedgifs(gifId);
			if (resolved) {
				out.push({
					...post,
					kind: "video",
					video: {
						url: resolved.url,
						width: 720,
						height: 1280,
						hasAudio: resolved.hasAudio
					}
				});
				continue;
			}
		}
		out.push(post);
	}
	return out;
}
var demoCache = null;
var DEMO_SUBS = [
	"Unexpected",
	"nextfuckinglevel",
	"Damnthatsinteresting",
	"nsfw",
	"NSFW_GIF"
];
async function fetchDemoFeed() {
	if (demoCache && Date.now() - demoCache.at < 48e4) return demoCache.posts;
	const collected = [];
	const results = await Promise.allSettled(DEMO_SUBS.map(async (sub) => {
		const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${encodeURIComponent(sub)}&limit=20&sort=desc&sort_type=created_utc`;
		const res = await fetch(url, {
			headers: { "User-Agent": USER_AGENT },
			signal: AbortSignal.timeout(8e3)
		});
		if (!res.ok) throw new Error(String(res.status));
		const json = await res.json();
		return (Array.isArray(json.data) ? json.data : []).map((row) => parseRedditPost({
			kind: "t3",
			data: row
		})).filter((p) => p !== null);
	}));
	for (const result of results) if (result.status === "fulfilled") collected.push(...result.value);
	const resolved = await resolveExternalVideos(collected);
	const unique = /* @__PURE__ */ new Map();
	for (const post of resolved) if (!unique.has(post.id)) unique.set(post.id, post);
	let posts = [...unique.values()];
	if (posts.length < 8) posts = [...FALLBACK_POSTS, ...posts];
	const seen = /* @__PURE__ */ new Set();
	posts = posts.filter((p) => {
		if (seen.has(p.id)) return false;
		seen.add(p.id);
		return true;
	});
	demoCache = {
		at: Date.now(),
		posts
	};
	return posts;
}
var FALLBACK_POSTS = [
	{
		id: "ednnv8zyfsrh1",
		name: "t3_ednnv8zyfsrh1",
		title: "Aura loss",
		subreddit: "Unexpected",
		author: "demo",
		permalink: "https://www.reddit.com/r/Unexpected/",
		nsfw: false,
		score: 12e3,
		createdUtc: Date.now() / 1e3,
		kind: "video",
		video: {
			url: "https://v.redd.it/ednnv8zyfsrh1/CMAF_720.mp4?source=fallback",
			audioUrl: "https://v.redd.it/ednnv8zyfsrh1/CMAF_AUDIO_128.mp4",
			width: 720,
			height: 1280,
			hasAudio: true
		}
	},
	{
		id: "vrzevvm55srh1",
		name: "t3_vrzevvm55srh1",
		title: "Bro meets Trump in China",
		subreddit: "Unexpected",
		author: "demo",
		permalink: "https://www.reddit.com/r/Unexpected/",
		nsfw: false,
		score: 8400,
		createdUtc: Date.now() / 1e3,
		kind: "video",
		video: {
			url: "https://v.redd.it/vrzevvm55srh1/CMAF_1080.mp4?source=fallback",
			audioUrl: "https://v.redd.it/vrzevvm55srh1/CMAF_AUDIO_128.mp4",
			width: 1080,
			height: 1920,
			hasAudio: true
		}
	},
	{
		id: "jm0t7832rrrh1",
		name: "t3_jm0t7832rrrh1",
		title: "TV Cleaning",
		subreddit: "Unexpected",
		author: "demo",
		permalink: "https://www.reddit.com/r/Unexpected/",
		nsfw: false,
		score: 5100,
		createdUtc: Date.now() / 1e3,
		kind: "video",
		video: {
			url: "https://v.redd.it/jm0t7832rrrh1/CMAF_720.mp4?source=fallback",
			audioUrl: "https://v.redd.it/jm0t7832rrrh1/CMAF_AUDIO_128.mp4",
			width: 720,
			height: 1280,
			hasAudio: true
		}
	},
	{
		id: "bvc48girnsrh1",
		name: "t3_bvc48girnsrh1",
		title: "Dress up by bf",
		subreddit: "Unexpected",
		author: "demo",
		permalink: "https://www.reddit.com/r/Unexpected/",
		nsfw: false,
		score: 2200,
		createdUtc: Date.now() / 1e3,
		kind: "video",
		video: {
			url: "https://v.redd.it/bvc48girnsrh1/CMAF_480.mp4?source=fallback",
			audioUrl: "https://v.redd.it/bvc48girnsrh1/CMAF_AUDIO_128.mp4",
			width: 480,
			height: 854,
			hasAudio: true
		}
	}
];
//#endregion
export { exchangeCode, fetchDemoFeed, fetchSavedPage, passwordGrant, refreshGrant };
