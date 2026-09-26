import { i as __toESM } from "../_runtime.mjs";
import { b as require_jsx_runtime, q as require_react } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as redditExchangeCode, c as useFlick, i as redditDemoFeed, n as formatScore, o as redditPasswordLogin, r as loadAllSaved, s as shuffleInPlace, t as cn } from "./load-saved-CgdfsoWT.mjs";
import { a as LogOut, c as ExternalLink, d as ChevronLeft, f as ArrowLeft, i as Smartphone, l as Dices, n as Volume2, o as Link2, s as FileText, t as VolumeX, u as ChevronRight } from "../_libs/lucide-react.mjs";
import { t as cva } from "../_libs/class-variance-authority+clsx.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BbmrLxWV.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var buttonVariants = cva("inline-flex items-center justify-center gap-2 font-medium select-none outline-none disabled:pointer-events-none disabled:opacity-40 transition-[scale,background-color,opacity,color] duration-150 ease-out active:not-disabled:scale-[0.96] focus-visible:ring-2 focus-visible:ring-primary/70", {
	variants: {
		variant: {
			primary: "bg-primary text-primary-fg hover:bg-primary/90",
			secondary: "bg-surface-2 text-fg shadow-[var(--shadow-border)] hover:bg-surface",
			ghost: "bg-transparent text-fg hover:bg-fg/10",
			danger: "bg-danger/15 text-danger hover:bg-danger/25"
		},
		size: {
			lg: "h-12 px-5 rounded-xl text-base",
			md: "h-11 px-4 rounded-lg text-sm",
			sm: "h-9 px-3 rounded-md text-sm",
			icon: "size-12 rounded-full"
		}
	},
	defaultVariants: {
		variant: "primary",
		size: "md"
	}
});
function Button({ className, variant, size, type = "button", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type,
		className: cn(buttonVariants({
			variant,
			size
		}), className),
		...props
	});
}
function Input({ className, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
		className: cn("h-12 w-full rounded-lg bg-surface-2 px-4 text-base text-fg placeholder:text-subtle shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-primary/70", className),
		...props
	});
}
function Label({ className, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
		className: cn("text-sm font-medium text-muted", className),
		...props
	});
}
function redirectUri() {
	if (typeof window === "undefined") return "";
	return `${window.location.origin}/oauth`;
}
function randomState() {
	const bytes = /* @__PURE__ */ new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function ConnectForm() {
	const setScreen = useFlick((s) => s.setScreen);
	const setSession = useFlick((s) => s.setSession);
	const setPosts = useFlick((s) => s.setPosts);
	const setError = useFlick((s) => s.setError);
	const error = useFlick((s) => s.error);
	const [username, setUsername] = (0, import_react.useState)("");
	const [password, setPassword] = (0, import_react.useState)("");
	const [clientId, setClientId] = (0, import_react.useState)("");
	const [clientSecret, setClientSecret] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [help, setHelp] = (0, import_react.useState)(false);
	const oauthRedirect = (0, import_react.useMemo)(() => redirectUri(), []);
	async function connectWithPassword() {
		setBusy(true);
		setError(null);
		try {
			const tokens = await redditPasswordLogin({ data: {
				username,
				password,
				clientId,
				clientSecret
			} });
			const session = {
				username: tokens.username,
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresAt: tokens.expiresAt,
				clientId: clientId.trim(),
				clientSecret: clientSecret.trim()
			};
			setSession(session);
			const posts = await loadAllSaved(session);
			setPosts(shuffleInPlace(posts), "saved");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not connect to Reddit.");
			setScreen("connect");
		} finally {
			setBusy(false);
		}
	}
	function authorizeInBrowser() {
		if (!clientId.trim() || !clientSecret.trim()) {
			setError("Add your Reddit app ID and secret first.");
			return;
		}
		const state = randomState();
		sessionStorage.setItem("flick.oauth", JSON.stringify({
			state,
			clientId: clientId.trim(),
			clientSecret: clientSecret.trim(),
			redirectUri: oauthRedirect
		}));
		const url = new URL("https://www.reddit.com/api/v1/authorize.compact");
		url.searchParams.set("client_id", clientId.trim());
		url.searchParams.set("response_type", "code");
		url.searchParams.set("state", state);
		url.searchParams.set("redirect_uri", oauthRedirect);
		url.searchParams.set("duration", "permanent");
		url.searchParams.set("scope", "identity history read");
		if (!window.open(url.toString(), "reddit-oauth", "width=480,height=740")) window.location.href = url.toString();
	}
	async function playDemo() {
		setBusy(true);
		setError(null);
		useFlick.getState().setLoading("Shuffling a live Reddit mix…");
		try {
			const posts = await redditDemoFeed();
			setPosts(shuffleInPlace(posts), "demo");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Demo feed failed.");
			setScreen("connect");
		} finally {
			setBusy(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex min-h-dvh flex-col bg-bg px-5 pt-safe pb-safe",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "flex items-center gap-3 py-4",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				variant: "ghost",
				size: "icon",
				className: "size-11",
				onClick: () => setScreen("home"),
				"aria-label": "Back",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeft, { className: "size-5" })
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-lg font-semibold",
				children: "Sign in with Reddit"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Pull every saved post, NSFW included."
			})] })]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
			className: "flex flex-1 flex-col gap-4 pb-8",
			onSubmit: (e) => {
				e.preventDefault();
				connectWithPassword();
			},
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-1.5",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
						htmlFor: "user",
						children: "Reddit username"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
						id: "user",
						autoComplete: "username",
						value: username,
						onChange: (e) => setUsername(e.target.value),
						required: true
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-1.5",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
						htmlFor: "pass",
						children: "Reddit password"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
						id: "pass",
						type: "password",
						autoComplete: "current-password",
						value: password,
						onChange: (e) => setPassword(e.target.value),
						required: true
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-1.5",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
						htmlFor: "cid",
						children: "App ID"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
						id: "cid",
						value: clientId,
						onChange: (e) => setClientId(e.target.value),
						required: true,
						autoCapitalize: "off",
						spellCheck: false
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-1.5",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
						htmlFor: "csec",
						children: "App secret"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
						id: "csec",
						type: "password",
						value: clientSecret,
						onChange: (e) => setClientSecret(e.target.value),
						required: true,
						autoCapitalize: "off",
						spellCheck: false
					})]
				}),
				error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-danger",
					children: error
				}) : null,
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "submit",
					size: "lg",
					className: "mt-2 w-full",
					disabled: busy,
					children: busy ? "Connecting…" : "Shuffle my saves"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "button",
					variant: "secondary",
					size: "lg",
					className: "w-full",
					disabled: busy,
					onClick: authorizeInBrowser,
					children: "Authorize in browser"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "button",
					variant: "ghost",
					size: "md",
					className: "w-full",
					disabled: busy,
					onClick: () => void playDemo(),
					children: "Play a sample feed"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "mt-2 text-left text-sm text-muted underline-offset-4 hover:underline",
					onClick: () => setHelp((v) => !v),
					children: help ? "Hide setup" : "How do I get an App ID?"
				}),
				help ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", {
					className: "list-decimal space-y-2 pl-5 text-sm leading-normal text-muted",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
							"Open",
							" ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
								className: "text-fg underline-offset-4 hover:underline",
								href: "https://www.reddit.com/prefs/apps",
								target: "_blank",
								rel: "noreferrer",
								children: ["reddit.com/prefs/apps", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExternalLink, { className: "ml-1 inline size-3.5" })]
							}),
							" ",
							"and create a ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-fg",
								children: "script"
							}),
							" app."
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
							"Redirect URI:",
							" ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "break-all text-fg",
								children: oauthRedirect || "http://localhost:8080/oauth"
							})
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Copy the ID under the app name, then the secret, into the fields above." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Two-factor accounts should use Authorize in browser instead of password." })
					]
				}) : null,
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-auto text-xs leading-normal text-subtle",
					children: "Credentials go only to Reddit. Flick stores the token on this device and never blurs NSFW or mutes video."
				})
			]
		})]
	});
}
function RailButton({ label, onClick, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		type: "button",
		onClick,
		className: "flex flex-col items-center gap-1 text-fg transition-[scale,opacity] duration-150 ease-out active:scale-[0.96]",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "flex size-12 items-center justify-center rounded-full bg-bg/45 shadow-[var(--shadow-border)] backdrop-blur-sm",
			children
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-xs font-medium text-fg/90",
			children: label
		})]
	});
}
function ActionRail({ muted, permalink, onShuffle, onToggleMute, onSignOut }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "absolute right-3 bottom-28 z-20 flex flex-col items-center gap-5 pb-safe",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RailButton, {
				label: muted ? "Sound" : "On",
				onClick: onToggleMute,
				children: muted ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VolumeX, { className: "size-6" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Volume2, { className: "size-6" })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RailButton, {
				label: "Shuffle",
				onClick: onShuffle,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dices, { className: "size-6" })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
				href: permalink,
				target: "_blank",
				rel: "noreferrer",
				className: "flex flex-col items-center gap-1 text-fg transition-[scale,opacity] duration-150 ease-out active:scale-[0.96]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "flex size-12 items-center justify-center rounded-full bg-bg/45 shadow-[var(--shadow-border)] backdrop-blur-sm",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExternalLink, { className: "size-5" })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-xs font-medium text-fg/90",
					children: "Reddit"
				})]
			}),
			onSignOut ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RailButton, {
				label: "Out",
				onClick: onSignOut,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LogOut, { className: "size-5" })
			}) : null
		]
	});
}
function VideoPlayer({ video, active, muted, onProgress }) {
	const videoRef = (0, import_react.useRef)(null);
	const audioRef = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		const el = videoRef.current;
		const audio = audioRef.current;
		if (!el) return;
		const sync = () => {
			if (!audio) return;
			if (Math.abs(el.currentTime - audio.currentTime) > .35) audio.currentTime = el.currentTime;
		};
		const onPlay = () => {
			audio?.play().catch(() => void 0);
		};
		const onPause = () => {
			audio?.pause();
		};
		const onTime = () => {
			sync();
			if (el.duration > 0) onProgress?.(el.currentTime / el.duration);
		};
		el.addEventListener("play", onPlay);
		el.addEventListener("pause", onPause);
		el.addEventListener("timeupdate", onTime);
		el.addEventListener("seeked", sync);
		return () => {
			el.removeEventListener("play", onPlay);
			el.removeEventListener("pause", onPause);
			el.removeEventListener("timeupdate", onTime);
			el.removeEventListener("seeked", sync);
		};
	}, [onProgress, video.audioUrl]);
	(0, import_react.useEffect)(() => {
		const el = videoRef.current;
		const audio = audioRef.current;
		if (!el) return;
		el.muted = muted;
		if (audio) audio.muted = muted;
		if (active) {
			const play = () => {
				el.play().catch(() => void 0);
				if (audio && !muted) audio.play().catch(() => void 0);
			};
			play();
		} else {
			el.pause();
			audio?.pause();
		}
	}, [
		active,
		muted,
		video.url
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
		ref: videoRef,
		src: video.url,
		className: "absolute inset-0 size-full object-cover",
		playsInline: true,
		loop: true,
		autoPlay: active,
		muted,
		preload: active ? "auto" : "metadata"
	}), video.audioUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("audio", {
		ref: audioRef,
		src: video.audioUrl,
		loop: true,
		preload: active ? "auto" : "none"
	}) : null] });
}
function PostSlide({ post, active, muted, offset, drag, animating }) {
	const [progress, setProgress] = (0, import_react.useState)(0);
	const [galleryIndex, setGalleryIndex] = (0, import_react.useState)(0);
	const gallery = post.gallery ?? [];
	const image = post.kind === "gallery" ? gallery[galleryIndex] ?? post.image : post.image;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
		className: cn("absolute inset-0 overflow-hidden bg-bg", animating && "slide-anim"),
		style: {
			transform: `translate3d(0, calc(${offset * 100}% + ${drag}px), 0)`,
			willChange: "transform"
		},
		children: [
			post.kind === "video" && post.video ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VideoPlayer, {
				video: post.video,
				active,
				muted,
				onProgress: setProgress
			}) : image ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
				src: image.url,
				alt: post.title,
				className: "absolute inset-0 size-full object-cover outline outline-1 -outline-offset-1 outline-fg/10",
				draggable: false
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "absolute inset-0 flex flex-col justify-end bg-surface px-5 pb-32 pt-safe",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mb-4 text-subtle",
						children: post.kind === "text" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileText, { className: "size-6" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link2, { className: "size-6" })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "max-w-prose text-2xl font-semibold leading-snug tracking-tight text-fg",
						children: post.title
					}),
					post.text ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-4 max-h-64 overflow-y-auto text-base leading-normal text-muted hide-scrollbar",
						children: post.text
					}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "pointer-events-none absolute inset-0 bg-linear-to-t from-bg/80 via-transparent to-bg/35" }),
			post.kind === "video" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "absolute inset-x-0 top-0 h-0.5 bg-fg/15",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "h-full bg-primary",
					style: { width: `${Math.min(100, progress * 100)}%` }
				})
			}) : null,
			post.kind === "gallery" && gallery.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-between px-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "pointer-events-auto flex size-11 items-center justify-center rounded-full bg-bg/40 text-fg",
					onClick: () => setGalleryIndex((i) => (i - 1 + gallery.length) % gallery.length),
					"aria-label": "Previous image",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-5" })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "pointer-events-auto flex size-11 items-center justify-center rounded-full bg-bg/40 text-fg",
					onClick: () => setGalleryIndex((i) => (i + 1) % gallery.length),
					"aria-label": "Next image",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-5" })
				})]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "absolute inset-x-0 bottom-0 z-10 px-4 pb-safe pt-16",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "max-w-xs pb-6 pr-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mb-2 flex flex-wrap items-center gap-2 text-sm font-medium text-fg",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "rounded-full bg-fg/12 px-2.5 py-1",
									children: ["r/", post.subreddit]
								}),
								post.nsfw ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "rounded-full bg-danger/20 px-2.5 py-1 text-danger",
									children: "NSFW"
								}) : null,
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "tabular-nums text-muted",
									children: formatScore(post.score)
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "text-base font-semibold leading-snug text-balance text-fg",
							children: post.title
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-1 text-sm text-muted",
							children: ["u/", post.author]
						})
					]
				})
			})
		]
	});
}
var THRESHOLD = 72;
function Feed() {
	const posts = useFlick((s) => s.posts);
	const index = useFlick((s) => s.index);
	const muted = useFlick((s) => s.muted);
	const source = useFlick((s) => s.source);
	const next = useFlick((s) => s.next);
	const prev = useFlick((s) => s.prev);
	const reroll = useFlick((s) => s.reroll);
	const toggleMuted = useFlick((s) => s.toggleMuted);
	const signOut = useFlick((s) => s.signOut);
	const setScreen = useFlick((s) => s.setScreen);
	const [drag, setDrag] = (0, import_react.useState)(0);
	const [animating, setAnimating] = (0, import_react.useState)(false);
	const startY = (0, import_react.useRef)(null);
	const lastY = (0, import_react.useRef)(0);
	const locked = (0, import_react.useRef)(false);
	const post = posts[index];
	const snap = (0, import_react.useCallback)((dir) => {
		setAnimating(true);
		if (dir === 1) {
			setDrag(-window.innerHeight);
			window.setTimeout(() => {
				next();
				setAnimating(false);
				setDrag(0);
			}, 240);
		} else if (dir === -1) {
			setDrag(window.innerHeight);
			window.setTimeout(() => {
				prev();
				setAnimating(false);
				setDrag(0);
			}, 240);
		} else {
			setDrag(0);
			window.setTimeout(() => setAnimating(false), 180);
		}
		if (dir !== 0 && navigator.vibrate) navigator.vibrate(8);
	}, [next, prev]);
	(0, import_react.useEffect)(() => {
		const onKey = (e) => {
			if (e.key === "ArrowDown" || e.key === "j") {
				e.preventDefault();
				snap(1);
			}
			if (e.key === "ArrowUp" || e.key === "k") {
				e.preventDefault();
				snap(-1);
			}
			if (e.key === " ") {
				e.preventDefault();
				toggleMuted();
			}
			if (e.key === "s") reroll();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [
		reroll,
		snap,
		toggleMuted
	]);
	(0, import_react.useEffect)(() => {
		const onWheel = (e) => {
			if (locked.current || animating) return;
			if (Math.abs(e.deltaY) < 24) return;
			locked.current = true;
			snap(e.deltaY > 0 ? 1 : -1);
			window.setTimeout(() => {
				locked.current = false;
			}, 420);
		};
		window.addEventListener("wheel", onWheel, { passive: true });
		return () => window.removeEventListener("wheel", onWheel);
	}, [animating, snap]);
	const onPointerDown = (e) => {
		if (animating) return;
		startY.current = e.clientY;
		lastY.current = e.clientY;
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e) => {
		if (startY.current == null) return;
		lastY.current = e.clientY;
		setDrag(e.clientY - startY.current);
	};
	const onPointerUp = () => {
		if (startY.current == null) return;
		const dy = lastY.current - startY.current;
		startY.current = null;
		if (dy < -72) snap(1);
		else if (dy > THRESHOLD) snap(-1);
		else snap(0);
	};
	if (!post) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-muted",
			children: "Nothing to play."
		})
	});
	const around = [
		-1,
		0,
		1
	].map((offset) => {
		if (posts.length === 0) return null;
		const i = (index + offset + posts.length) % posts.length;
		const item = posts[i];
		if (!item) return null;
		if (offset !== 0 && posts.length < 2) return null;
		return {
			offset,
			item,
			i
		};
	}).filter((v) => v !== null);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "relative h-dvh w-full touch-none overflow-hidden bg-bg select-none",
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel: onPointerUp,
		children: [
			around.map(({ offset, item, i }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PostSlide, {
				post: item,
				active: offset === 0 && !animating,
				muted,
				offset,
				drag,
				animating: animating || startY.current != null
			}, `${item.id}-${i === index ? "a" : offset}`)),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-safe",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "pointer-events-auto pt-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs font-medium uppercase tracking-widest text-fg/80",
						children: source === "saved" ? "Saved" : "Shuffle"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "tabular-nums text-sm text-muted",
						children: [
							index + 1,
							" / ",
							posts.length
						]
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "pointer-events-auto mt-3 rounded-full bg-bg/40 px-3 py-2 text-sm text-fg shadow-[var(--shadow-border)]",
					onClick: () => setScreen("home"),
					children: "Close"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActionRail, {
				muted,
				permalink: post.permalink,
				onShuffle: reroll,
				onToggleMute: toggleMuted,
				onSignOut: source === "saved" ? signOut : void 0
			})
		]
	});
}
function Landing() {
	const ageOk = useFlick((s) => s.ageOk);
	const acceptAge = useFlick((s) => s.acceptAge);
	const setScreen = useFlick((s) => s.setScreen);
	const setPosts = useFlick((s) => s.setPosts);
	const setError = useFlick((s) => s.setError);
	const session = useFlick((s) => s.session);
	const error = useFlick((s) => s.error);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [installEvent, setInstallEvent] = (0, import_react.useState)(null);
	const [standalone, setStandalone] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		const media = window.matchMedia("(display-mode: standalone)");
		setStandalone(media.matches || navigator.standalone === true);
		const onPrompt = (e) => {
			e.preventDefault();
			setInstallEvent(e);
		};
		window.addEventListener("beforeinstallprompt", onPrompt);
		return () => window.removeEventListener("beforeinstallprompt", onPrompt);
	}, []);
	async function playDemo() {
		setBusy(true);
		setError(null);
		useFlick.getState().setLoading("Shuffling a live Reddit mix…");
		try {
			const posts = await redditDemoFeed();
			setPosts(shuffleInPlace(posts), "demo");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load a sample feed.");
			setScreen("home");
		} finally {
			setBusy(false);
		}
	}
	async function playSaved() {
		if (!session) {
			setScreen("connect");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const posts = await loadAllSaved(session);
			setPosts(shuffleInPlace(posts), "saved");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load saved posts.");
			setScreen("connect");
		} finally {
			setBusy(false);
		}
	}
	if (!ageOk) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grain flex min-h-dvh flex-col justify-end bg-bg px-6 pb-safe pt-safe",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-end pb-10",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs font-medium uppercase tracking-[0.22em] text-muted",
					children: "18+ player"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-3 text-5xl font-semibold tracking-tight text-fg",
					children: "Flick"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-4 max-w-sm text-base leading-normal text-muted",
					children: "Full-screen Reddit saves. Sound on. No blur, no feed filters."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					size: "lg",
					className: "mt-8 w-full",
					onClick: acceptAge,
					children: "I am 18 or older"
				})
			]
		})
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grain flex min-h-dvh flex-col bg-bg px-6 pt-safe pb-safe",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex-1 pt-12",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-medium uppercase tracking-[0.22em] text-muted",
							children: "Android player"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
							className: "mt-4 text-6xl font-semibold tracking-tight text-fg",
							children: "Flick"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-4 max-w-sm text-lg leading-snug text-muted",
							children: "Sign in, shuffle every saved post, swipe like TikTok."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
							className: "mt-8 space-y-3 text-sm text-muted",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex items-center gap-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Volume2, { className: "size-4 text-fg" }), "Sound enabled. Videos play unmuted."]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex items-center gap-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "inline-block size-4 rounded-full bg-danger/70" }), "NSFW is shown. Nothing is blurred."]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "flex items-center gap-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Smartphone, { className: "size-4 text-fg" }), "Install to your home screen for a full-screen app."]
								})
							]
						})
					]
				}),
				error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mb-3 text-sm text-danger",
					children: error
				}) : null,
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-3 pb-8",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "lg",
							className: "w-full",
							disabled: busy,
							onClick: () => void playSaved(),
							children: session ? `Shuffle u/${session.username}` : "Sign in with Reddit"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "lg",
							variant: "secondary",
							className: "w-full",
							disabled: busy,
							onClick: () => void playDemo(),
							children: busy ? "Loading…" : "Try a sample shuffle"
						}),
						session ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "md",
							variant: "ghost",
							className: "w-full",
							onClick: () => setScreen("connect"),
							children: "Use a different account"
						}) : null,
						installEvent && !standalone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "md",
							variant: "ghost",
							className: "w-full",
							onClick: () => void installEvent.prompt(),
							children: "Install on this phone"
						}) : null
					]
				})
			]
		})
	});
}
function LoadingView() {
	const label = useFlick((s) => s.loadingLabel);
	const count = useFlick((s) => s.loadingCount);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium uppercase tracking-[0.22em] text-muted",
				children: "Flick"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-lg text-fg",
				children: label || "Loading…"
			}),
			count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-2 tabular-nums text-sm text-muted",
				children: [count, " posts"]
			}) : null
		]
	});
}
function AppShell() {
	const hydrated = useFlick((s) => s.hydrated);
	const screen = useFlick((s) => s.screen);
	const setHydrated = useFlick((s) => s.setHydrated);
	const setSession = useFlick((s) => s.setSession);
	const setPosts = useFlick((s) => s.setPosts);
	const setError = useFlick((s) => s.setError);
	const setScreen = useFlick((s) => s.setScreen);
	(0, import_react.useEffect)(() => {
		const t = window.setTimeout(() => {
			if (!useFlick.getState().hydrated) setHydrated();
		}, 50);
		return () => window.clearTimeout(t);
	}, [setHydrated]);
	(0, import_react.useEffect)(() => {
		const onMessage = (event) => {
			const data = event.data;
			if (data?.type !== "flick-oauth" || !data.code) return;
			finishOauth(data.code, data.state ?? "");
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);
	async function finishOauth(code, state) {
		const raw = sessionStorage.getItem("flick.oauth");
		if (!raw) return;
		const saved = JSON.parse(raw);
		if (saved.state !== state) {
			setError("OAuth state mismatch. Try authorizing again.");
			setScreen("connect");
			return;
		}
		try {
			useFlick.getState().setLoading("Signing in with Reddit…");
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
			setSession(session);
			const posts = await loadAllSaved(session);
			setPosts(shuffleInPlace(posts), "saved");
			sessionStorage.removeItem("flick.oauth");
		} catch (err) {
			setError(err instanceof Error ? err.message : "OAuth failed.");
			setScreen("connect");
		}
	}
	if (!hydrated) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "flex min-h-dvh items-center justify-center bg-bg",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-muted",
			children: "Flick"
		})
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mx-auto min-h-dvh w-full max-w-md bg-bg shadow-[var(--shadow-border)] md:my-0 md:min-h-dvh",
		children: screen === "feed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Feed, {}) : screen === "connect" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConnectForm, {}) : screen === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoadingView, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Landing, {})
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {});
}
//#endregion
export { Home as component };
