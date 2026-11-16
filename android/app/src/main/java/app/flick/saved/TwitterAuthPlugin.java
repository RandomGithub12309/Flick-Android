package app.flick.saved;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-app WebView login for X (Twitter) so Flick can read the user's own
 * `auth_token` and `ct0` session cookies without any paid API key.
 */
@CapacitorPlugin(name = "TwitterAuth")
public class TwitterAuthPlugin extends Plugin {
    private static final String CHROME_MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    private static final String X_WEB_BEARER =
            "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

    private WebView backgroundWebView;
    private String capturedBookmarksUrl;

    @SuppressLint("SetJavaScriptEnabled")
    @PluginMethod
    public void login(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Dialog dialog = new Dialog(getActivity(), android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            LinearLayout root = new LinearLayout(getActivity());
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.parseColor("#09090b"));

            LinearLayout bar = new LinearLayout(getActivity());
            bar.setOrientation(LinearLayout.HORIZONTAL);
            bar.setGravity(Gravity.CENTER_VERTICAL);
            bar.setBackgroundColor(Color.parseColor("#09090b"));
            int padH = dp(16);
            int padV = dp(10);
            bar.setPadding(padH, padV, padH, padV);

            TextView title = new TextView(getActivity());
            title.setText("Sign in to X");
            title.setTextColor(Color.WHITE);
            title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            bar.addView(title, titleParams);

            Button cancel = new Button(getActivity());
            cancel.setText("Cancel");
            cancel.setTextColor(Color.parseColor("#e4e4e7"));
            cancel.setBackgroundColor(Color.TRANSPARENT);
            cancel.setAllCaps(false);
            bar.addView(cancel);

            WebView webView = new WebView(getActivity());
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setUserAgentString(CHROME_MOBILE_UA);

            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setAcceptThirdPartyCookies(webView, true);

            root.addView(bar, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            root.addView(webView, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

            dialog.setContentView(root);

            AtomicBoolean done = new AtomicBoolean(false);

            cancel.setOnClickListener(v -> {
                if (done.compareAndSet(false, true)) {
                    dialog.dismiss();
                    webView.destroy();
                    call.reject("Sign-in cancelled");
                }
            });

            dialog.setOnCancelListener(d -> {
                if (done.compareAndSet(false, true)) {
                    webView.destroy();
                    call.reject("Sign-in cancelled");
                }
            });

            Runnable checkCookies = () -> {
                if (done.get()) return;
                String xCookies = cm.getCookie("https://x.com");
                String twCookies = cm.getCookie("https://twitter.com");
                String merged = (xCookies != null ? xCookies : "") + "; " + (twCookies != null ? twCookies : "");
                String authToken = extractCookie(merged, "auth_token");
                String ct0 = extractCookie(merged, "ct0");
                if (authToken != null && !authToken.isEmpty() && ct0 != null && !ct0.isEmpty()) {
                    if (!done.compareAndSet(false, true)) return;
                    cm.flush();
                    webView.evaluateJavascript(
                            "(function(){try{"
                                    + "var a=document.querySelector('a[data-testid=\"AppTabBar_Profile_Link\"]');"
                                    + "if(a&&a.getAttribute('href'))return a.getAttribute('href').replace(/^\\//,'');"
                                    + "return '';"
                                    + "}catch(e){return '';}})()",
                            value -> {
                                String handle = "";
                                if (value != null && !value.equals("null")) {
                                    handle = value.replace("\"", "").trim();
                                }
                                JSObject ret = new JSObject();
                                ret.put("authToken", authToken);
                                ret.put("ct0", ct0);
                                ret.put("screenName", handle);
                                dialog.dismiss();
                                webView.destroy();
                                call.resolve(ret);
                            });
                }
            };

            webView.setWebChromeClient(new WebChromeClient());
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return false;
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    checkCookies.run();
                }

                @Override
                public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                    super.doUpdateVisitedHistory(view, url, isReload);
                    checkCookies.run();
                }
            });

            dialog.show();
            webView.loadUrl("https://x.com/i/flow/login");
        });
    }

    @PluginMethod
    public void logout(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CookieManager cm = CookieManager.getInstance();
            cm.setCookie("https://x.com", "auth_token=; Max-Age=0; path=/; domain=.x.com");
            cm.setCookie("https://x.com", "ct0=; Max-Age=0; path=/; domain=.x.com");
            cm.flush();
            capturedBookmarksUrl = null;
            if (backgroundWebView != null) {
                backgroundWebView.destroy();
                backgroundWebView = null;
            }
            call.resolve();
        });
    }

    /**
     * Loads https://x.com/i/bookmarks inside an authenticated offscreen WebView and captures
     * X's own live Bookmarks GraphQL response & URL (no brittle queryId scraping needed).
     * For subsequent pages (cursor != null), replays the captured live URL with the cursor.
     */
    @SuppressLint("SetJavaScriptEnabled")
    @PluginMethod
    public void loadBookmarks(PluginCall call) {
        String authToken = call.getString("authToken", "");
        String ct0 = call.getString("ct0", "");
        String cursor = call.getString("cursor", null);

        if (authToken == null || authToken.isEmpty() || ct0 == null || ct0.isEmpty()) {
            call.reject("Missing authToken or ct0");
            return;
        }

        getActivity().runOnUiThread(() -> {
            syncCookiesToWebView("auth_token=" + authToken + "; ct0=" + ct0);

            if (cursor != null && !cursor.isEmpty() && capturedBookmarksUrl != null) {
                replayCapturedBookmarks(capturedBookmarksUrl, ct0, cursor, call, true);
                return;
            }

            loadBookmarksPageInWebView(ct0, cursor, call);
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void loadBookmarksPageInWebView(String ct0, String cursor, PluginCall call) {
        if (backgroundWebView == null) {
            backgroundWebView = createOffscreenWebView();
        }
        WebView wv = backgroundWebView;
        AtomicBoolean settled = new AtomicBoolean(false);

        String hookJs = "(function(){"
                + "if(window.__flickBookmarksHooked)return;"
                + "window.__flickBookmarksHooked=true;"
                + "window.__flickBookmarksRes=null;"
                + "var origFetch=window.fetch;"
                + "window.fetch=function(input,init){"
                + "  var u=typeof input==='string'?input:(input&&input.url)||'';"
                + "  return origFetch.apply(this,arguments).then(function(res){"
                + "    if(u.indexOf('/i/api/graphql/')!==-1&&u.indexOf('/Bookmarks')!==-1){"
                + "      try{res.clone().text().then(function(t){"
                + "        window.__flickBookmarksRes={status:res.status,body:t,url:u};"
                + "      });}catch(e){}"
                + "    }"
                + "    return res;"
                + "  });"
                + "};"
                + "var origOpen=XMLHttpRequest.prototype.open;"
                + "var origSend=XMLHttpRequest.prototype.send;"
                + "XMLHttpRequest.prototype.open=function(m,u){this.__flickU=u;return origOpen.apply(this,arguments);};"
                + "XMLHttpRequest.prototype.send=function(){"
                + "  if(this.__flickU&&this.__flickU.indexOf('/i/api/graphql/')!==-1&&this.__flickU.indexOf('/Bookmarks')!==-1){"
                + "    this.addEventListener('load',function(){"
                + "      window.__flickBookmarksRes={status:this.status,body:this.responseText,url:this.__flickU};"
                + "    });"
                + "  }"
                + "  return origSend.apply(this,arguments);"
                + "};"
                + "})();";

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                view.evaluateJavascript(hookJs, null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(hookJs, null);
            }
        });

        wv.loadUrl("https://x.com/i/bookmarks");
        pollBookmarksCapture(wv, ct0, cursor, call, settled, 0);
    }

    private void pollBookmarksCapture(
            WebView wv,
            String ct0,
            String cursor,
            PluginCall call,
            AtomicBoolean settled,
            int attempt) {
        if (settled.get()) return;
        if (backgroundWebView == null || attempt > 60) {
            if (settled.compareAndSet(false, true)) {
                call.reject("Timed out loading X bookmarks — make sure your auth_token and ct0 cookies are valid.");
            }
            return;
        }
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (settled.get() || backgroundWebView == null) return;
            String currentUrl = wv.getUrl();
            if (currentUrl != null && (currentUrl.contains("/i/flow/login") || currentUrl.endsWith("/login"))) {
                if (settled.compareAndSet(false, true)) {
                    call.reject("X redirected to login — your auth_token or ct0 cookie is expired or invalid.");
                }
                return;
            }

            String probeJs = "(function(){"
                    + "var a=document.querySelector('a[data-testid=\"AppTabBar_Profile_Link\"]');"
                    + "var sn=a&&a.getAttribute('href')?a.getAttribute('href').replace(/^\\//,''):'';"
                    + "if(window.__flickBookmarksRes){"
                    + "  var r=window.__flickBookmarksRes;"
                    + "  window.__flickBookmarksRes=null;"
                    + "  return JSON.stringify({hit:true,status:r.status,body:r.body,url:r.url,screenName:sn});"
                    + "}"
                    + "var entries=performance.getEntriesByType('resource');"
                    + "for(var i=entries.length-1;i>=0;i--){"
                    + "  var n=entries[i].name||'';"
                    + "  if(n.indexOf('/i/api/graphql/')!==-1&&n.indexOf('/Bookmarks')!==-1){"
                    + "    return JSON.stringify({hit:false,url:n,screenName:sn});"
                    + "  }"
                    + "}"
                    + "return null;"
                    + "})()";

            wv.evaluateJavascript(probeJs, result -> {
                if (settled.get()) return;
                if (result == null || "null".equals(result)) {
                    pollBookmarksCapture(wv, ct0, cursor, call, settled, attempt + 1);
                    return;
                }
                try {
                    String unquoted = new org.json.JSONTokener(result).nextValue().toString();
                    JSONObject obj = new JSONObject(unquoted);
                    String foundUrl = obj.optString("url", "");
                    String screenName = obj.optString("screenName", "");
                    if (!foundUrl.isEmpty()) {
                        capturedBookmarksUrl = foundUrl;
                    }
                    if (obj.optBoolean("hit", false) && (cursor == null || cursor.isEmpty())) {
                        if (settled.compareAndSet(false, true)) {
                            JSObject ret = new JSObject();
                            ret.put("status", obj.optInt("status", 200));
                            ret.put("body", obj.optString("body", ""));
                            ret.put("url", foundUrl);
                            ret.put("screenName", screenName);
                            call.resolve(ret);
                        }
                        return;
                    }
                    if (!foundUrl.isEmpty() && settled.compareAndSet(false, true)) {
                        replayCapturedBookmarks(foundUrl, ct0, cursor, call, false);
                        return;
                    }
                } catch (Exception ignored) {
                }
                pollBookmarksCapture(wv, ct0, cursor, call, settled, attempt + 1);
            });
        }, 250);
    }

    private void replayCapturedBookmarks(
            String baseUrl,
            String ct0,
            String cursor,
            PluginCall call,
            boolean allowReloadFallback) {
        try {
            Uri uri = Uri.parse(baseUrl);
            Uri.Builder builder = uri.buildUpon().clearQuery();
            for (String name : uri.getQueryParameterNames()) {
                if ("variables".equals(name)) {
                    JSONObject vars = new JSONObject();
                    vars.put("count", 40);
                    vars.put("includePromotedContent", false);
                    if (cursor != null && !cursor.isEmpty()) {
                        vars.put("cursor", cursor);
                    }
                    builder.appendQueryParameter("variables", vars.toString());
                } else {
                    String val = uri.getQueryParameter(name);
                    if (val != null) builder.appendQueryParameter(name, val);
                }
            }
            String targetUrl = builder.build().toString();
            String callbackId = "__flickReplay_" + System.nanoTime();
            JSONObject spec = new JSONObject();
            spec.put("url", targetUrl);
            JSONObject hdrs = new JSONObject();
            hdrs.put("authorization", "Bearer " + X_WEB_BEARER);
            hdrs.put("x-csrf-token", ct0);
            hdrs.put("x-twitter-auth-type", "OAuth2Session");
            hdrs.put("x-twitter-active-user", "yes");
            hdrs.put("x-twitter-client-language", "en");
            spec.put("headers", hdrs);

            String js = "(async function(){"
                    + "try{"
                    + "var s=" + spec.toString() + ";"
                    + "var r=await fetch(s.url,{method:'GET',headers:s.headers,credentials:'include'});"
                    + "var t=await r.text();"
                    + "var a=document.querySelector('a[data-testid=\"AppTabBar_Profile_Link\"]');"
                    + "var sn=a&&a.getAttribute('href')?a.getAttribute('href').replace(/^\\//,''):'';"
                    + "window." + callbackId + "={status:r.status,body:t,screenName:sn};"
                    + "}catch(e){"
                    + "window." + callbackId + "={status:0,error:String(e)};"
                    + "}"
                    + "})();";

            if (backgroundWebView == null) {
                backgroundWebView = createOffscreenWebView();
            }
            backgroundWebView.evaluateJavascript(js, null);
            pollReplayResult(callbackId, ct0, cursor, call, allowReloadFallback, 0);
        } catch (Exception e) {
            if (allowReloadFallback) {
                capturedBookmarksUrl = null;
                loadBookmarksPageInWebView(ct0, cursor, call);
            } else {
                call.reject("Failed to replay X bookmarks request", e);
            }
        }
    }

    private void pollReplayResult(
            String callbackId,
            String ct0,
            String cursor,
            PluginCall call,
            boolean allowReloadFallback,
            int attempt) {
        if (backgroundWebView == null || attempt > 60) {
            call.reject("X bookmarks request timed out");
            return;
        }
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (backgroundWebView == null) {
                call.reject("X WebView destroyed");
                return;
            }
            backgroundWebView.evaluateJavascript(
                    "(function(){var r=window." + callbackId + ";if(!r)return null;delete window." + callbackId + ";return JSON.stringify(r);})()",
                    result -> {
                        if (result == null || "null".equals(result)) {
                            pollReplayResult(callbackId, ct0, cursor, call, allowReloadFallback, attempt + 1);
                            return;
                        }
                        try {
                            String unquoted = new org.json.JSONTokener(result).nextValue().toString();
                            JSONObject obj = new JSONObject(unquoted);
                            int status = obj.optInt("status", 0);
                            if ((status == 404 || status == 403 || status == 0) && allowReloadFallback) {
                                capturedBookmarksUrl = null;
                                loadBookmarksPageInWebView(ct0, cursor, call);
                                return;
                            }
                            JSObject ret = new JSObject();
                            ret.put("status", status);
                            ret.put("body", obj.optString("body", ""));
                            ret.put("screenName", obj.optString("screenName", ""));
                            if (obj.has("error")) ret.put("error", obj.optString("error"));
                            call.resolve(ret);
                        } catch (Exception e) {
                            call.reject("Failed to parse X bookmarks response", e);
                        }
                    });
        }, 150);
    }

    /**
     * Executes a GraphQL fetch inside an offscreen WebView on the https://x.com origin
     * so browser cookies and X's own client context are used if direct HTTP fails.
     */
    @SuppressLint("SetJavaScriptEnabled")
    @PluginMethod
    public void graphqlFetch(PluginCall call) {
        String url = call.getString("url", "");
        String method = call.getString("method", "GET");
        JSObject headersObj = call.getObject("headers", new JSObject());
        String body = call.getString("body", null);

        if (url == null || url.isEmpty()) {
            call.reject("Missing url");
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (headersObj != null) {
                Iterator<String> cookieKeys = headersObj.keys();
                while (cookieKeys.hasNext()) {
                    String k = cookieKeys.next();
                    if ("cookie".equalsIgnoreCase(k)) {
                        String cookieVal = headersObj.optString(k, "");
                        if (cookieVal != null && !cookieVal.isEmpty()) {
                            syncCookiesToWebView(cookieVal);
                        }
                        break;
                    }
                }
            }
            ensureBackgroundWebView(() -> {
                try {
                    JSONObject reqSpec = new JSONObject();
                    reqSpec.put("url", url);
                    reqSpec.put("method", method);
                    JSONObject hdrs = new JSONObject();
                    if (headersObj != null) {
                        Iterator<String> keys = headersObj.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            if (!"cookie".equalsIgnoreCase(k)) {
                                hdrs.put(k, headersObj.getString(k));
                            }
                        }
                    }
                    reqSpec.put("headers", hdrs);
                    if (body != null) reqSpec.put("body", body);

                    String callbackId = "__flickCb_" + System.nanoTime();
                    String js = "(async function(){"
                            + "try{"
                            + "const spec=" + reqSpec.toString() + ";"
                            + "const opts={method:spec.method,headers:spec.headers,credentials:'include'};"
                            + "if(spec.body&&spec.method!=='GET')opts.body=spec.body;"
                            + "const r=await fetch(spec.url,opts);"
                            + "const t=await r.text();"
                            + "window." + callbackId + "={status:r.status,body:t};"
                            + "}catch(e){"
                            + "window." + callbackId + "={status:0,error:String(e)};"
                            + "}"
                            + "})();";

                    backgroundWebView.evaluateJavascript(js, null);
                    pollJsResult(callbackId, call, 0);
                } catch (Exception e) {
                    call.reject("graphqlFetch setup failed", e);
                }
            });
        });
    }

    private void pollJsResult(String callbackId, PluginCall call, int attempt) {
        if (backgroundWebView == null || attempt > 60) {
            call.reject("X WebView request timed out");
            return;
        }
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (backgroundWebView == null) {
                call.reject("X WebView destroyed");
                return;
            }
            backgroundWebView.evaluateJavascript(
                    "(function(){var r=window." + callbackId + ";if(!r)return null;delete window." + callbackId + ";return JSON.stringify(r);})()",
                    result -> {
                        if (result == null || "null".equals(result)) {
                            pollJsResult(callbackId, call, attempt + 1);
                            return;
                        }
                        try {
                            String unquoted = new org.json.JSONTokener(result).nextValue().toString();
                            JSONObject obj = new JSONObject(unquoted);
                            JSObject ret = new JSObject();
                            ret.put("status", obj.optInt("status", 0));
                            ret.put("body", obj.optString("body", ""));
                            if (obj.has("error")) ret.put("error", obj.optString("error"));
                            call.resolve(ret);
                        } catch (Exception e) {
                            call.reject("Failed to parse X WebView response", e);
                        }
                    });
        }, 150);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createOffscreenWebView() {
        WebView wv = new WebView(getContext());
        WebSettings settings = wv.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUserAgentString(CHROME_MOBILE_UA);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);
        wv.layout(0, 0, 1080, 1920);
        return wv;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void ensureBackgroundWebView(Runnable onReady) {
        if (backgroundWebView != null) {
            onReady.run();
            return;
        }
        WebView wv = createOffscreenWebView();
        AtomicBoolean fired = new AtomicBoolean(false);
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (fired.compareAndSet(false, true)) {
                    onReady.run();
                }
            }
        });
        backgroundWebView = wv;
        wv.loadUrl("https://x.com/robots.txt");
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getContext().getResources().getDisplayMetrics()));
    }

    private static void syncCookiesToWebView(String cookieHeader) {
        if (cookieHeader == null || cookieHeader.isEmpty()) return;
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        String[] parts = cookieHeader.split(";");
        for (String part : parts) {
            String trimmed = part.trim();
            int eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            String name = trimmed.substring(0, eq).trim();
            String value = trimmed.substring(eq + 1).trim();
            if (name.isEmpty() || value.isEmpty()) continue;
            cm.setCookie(
                    "https://x.com",
                    name + "=" + value + "; domain=.x.com; path=/; Secure; SameSite=None");
        }
        cm.flush();
    }

    private static String extractCookie(String cookieHeader, String name) {
        if (cookieHeader == null || cookieHeader.isEmpty()) return null;
        String[] parts = cookieHeader.split(";");
        String prefix = name + "=";
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.startsWith(prefix)) {
                return trimmed.substring(prefix.length()).trim();
            }
        }
        return null;
    }
}
