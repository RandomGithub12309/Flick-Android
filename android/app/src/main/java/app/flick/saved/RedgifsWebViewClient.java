package app.flick.saved;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Re-issues redgifs CDN media requests with the headers the CDN demands.
 *
 * <p>With no server behind the packaged app there is no {@code /api/redgifs/<id>}
 * proxy to stream clips through, so the feed hands the player the CDN link
 * itself. That link is signed per requesting IP and the CDN validates both
 * User-Agent and Referer, so the WebView's own request — which carries the
 * app's agent and {@code https://localhost/} as its referer — is answered with a
 * 403. Here the request is caught, re-issued natively with the header set the
 * CDN wants, and the body is streamed straight back to the player.
 *
 * <p>Range is forwarded and 206 passed through unchanged, which is what keeps
 * seeking working: every seek is a new Range GET, and without the 206 plus
 * {@code Content-Range} the WebView treats the clip as unseekable.
 *
 * <p>Anything that isn't redgifs media is handed straight back to Capacitor,
 * which serves the bundled app out of {@code webDir} — see
 * {@code BridgeWebViewClient#shouldInterceptRequest}.
 *
 * <p>This is Java rather than Kotlin to match the rest of the native project,
 * which has no Kotlin toolchain configured; adding one would mean a Gradle
 * plugin and stdlib dependency to sync for no behavioural difference.
 */
public class RedgifsWebViewClient extends BridgeWebViewClient {

    private static final String REDGIFS_MEDIA_HOST = "media.redgifs.com";
    private static final String REDGIFS_SITE = "https://www.redgifs.com";

    /** The desktop-Chrome agent redgifs' CDN gates on. Must match REDGIFS_UA in src/lib/reddit/reddit-api.ts. */
    private static final String BROWSER_UA =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36";

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    public RedgifsWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (!isRedgifsMedia(request)) {
            return super.shouldInterceptRequest(view, request);
        }
        WebResourceResponse response = fetchAsCdn(request);
        // A null response tells the WebView to make the request itself, which
        // redgifs will refuse. That surfaces as a media error, and the player
        // already treats a failed source as a cue to fall back to Reddit's own
        // copy of the clip rather than skipping the post.
        return response;
    }

    private static boolean isRedgifsMedia(WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return false;
        return REDGIFS_MEDIA_HOST.equalsIgnoreCase(request.getUrl().getHost());
    }

    private static WebResourceResponse fetchAsCdn(WebResourceRequest request) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);

            connection.setRequestProperty("User-Agent", BROWSER_UA);
            connection.setRequestProperty("Referer", refererFor(request));
            connection.setRequestProperty("Origin", REDGIFS_SITE);

            // The seek path: forward whatever range the player asked for and let
            // the 206 + Content-Range come back untouched.
            String range = request.getRequestHeaders().get("Range");
            if (range == null) range = request.getRequestHeaders().get("range");
            if (range != null) connection.setRequestProperty("Range", range);

            int status = connection.getResponseCode();
            InputStream body = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (body == null) {
                return null;
            }

            Map<String, String> headers = new LinkedHashMap<>();
            copyHeader(connection, headers, "Content-Type");
            copyHeader(connection, headers, "Content-Length");
            copyHeader(connection, headers, "Content-Range");
            copyHeader(connection, headers, "Accept-Ranges");
            copyHeader(connection, headers, "ETag");
            if (!headers.containsKey("Content-Type")) headers.put("Content-Type", "video/mp4");
            if (!headers.containsKey("Accept-Ranges")) headers.put("Accept-Ranges", "bytes");

            return new WebResourceResponse(
                headers.get("Content-Type"),
                null,
                status,
                reasonFor(status),
                headers,
                body
            );
        } catch (Exception e) {
            return null;
        }
    }

    private static void copyHeader(
        HttpURLConnection connection,
        Map<String, String> into,
        String name
    ) {
        String value = connection.getHeaderField(name);
        if (value != null) into.put(name, value);
    }

    /**
     * The CDN wants a redgifs watch URL as the referer. The clip id isn't
     * reliably recoverable from the media path, so this uses the filename as
     * the watch slug and falls back to the site root.
     */
    private static String refererFor(WebResourceRequest request) {
        String path = request.getUrl().getPath();
        if (path == null) return REDGIFS_SITE + "/";
        String name = path.substring(path.lastIndexOf('/') + 1);
        int dot = name.lastIndexOf('.');
        if (dot > 0) name = name.substring(0, dot);
        // Redgifs publishes `-mobile` and `-silent` encodes of the same clip.
        if (name.endsWith("-mobile")) name = name.substring(0, name.length() - "-mobile".length());
        if (name.endsWith("-silent")) name = name.substring(0, name.length() - "-silent".length());
        return name.isEmpty() ? REDGIFS_SITE + "/" : REDGIFS_SITE + "/watch/" + name;
    }

    private static String reasonFor(int status) {
        switch (status) {
            case 200:
                return "OK";
            case 206:
                return "Partial Content";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 416:
                return "Range Not Satisfiable";
            default:
                return "OK";
        }
    }
}
