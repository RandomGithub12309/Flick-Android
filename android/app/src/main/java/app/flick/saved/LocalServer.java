package app.flick.saved;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Embedded loopback HTTP server running inside the Flick APK on 127.0.0.1.
 *
 * Streams Redgifs MP4s with the User-Agent, Origin, and Referer headers the
 * CDN requires, forwarding HTTP Range requests so WebView video seeking works
 * without an external backend or Vercel deployment.
 */
public final class LocalServer {
    private static final String REDGIFS_UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36";
    private static final Pattern VALID_ID = Pattern.compile("^[a-zA-Z0-9]{4,64}$");
    private static final long TOKEN_TTL_MS = 6L * 60 * 60 * 1000;
    private static final long DIRECT_TTL_MS = 5L * 60 * 1000;
    private static final long AUTH_BACKOFF_MS = 60L * 1000;

    private static volatile LocalServer instance;

    private final ServerSocket serverSocket;
    private final int port;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile boolean running = true;

    private final Object authLock = new Object();
    private String redgifsToken = null;
    private long redgifsTokenExp = 0;
    private long redgifsAuthFailedAt = 0;

    private static final class CachedUrl {
        final String url;
        final long at;

        CachedUrl(String url, long at) {
            this.url = url;
            this.at = at;
        }
    }

    private final Map<String, CachedUrl> directCache = new ConcurrentHashMap<>();

    private LocalServer() throws IOException {
        this.serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        this.port = this.serverSocket.getLocalPort();
        Thread acceptThread = new Thread(this::acceptLoop, "flick-local-server");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    public static synchronized int ensureStarted() throws IOException {
        if (instance == null || !instance.running) {
            instance = new LocalServer();
        }
        return instance.port;
    }

    public static int getRunningPort() {
        LocalServer current = instance;
        return current != null ? current.port : 0;
    }

    public static synchronized void stopServer() {
        if (instance != null) {
            instance.shutdown();
            instance = null;
        }
    }

    private void shutdown() {
        running = false;
        try {
            serverSocket.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = serverSocket.accept();
                pool.execute(() -> handleClient(client));
            } catch (IOException e) {
                if (running) {
                    try {
                        Thread.sleep(50);
                    } catch (InterruptedException ignored) {
                        break;
                    }
                }
            }
        }
    }

    private void handleClient(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(15000);
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(s.getInputStream(), StandardCharsets.US_ASCII));
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) return;

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0].toUpperCase(Locale.US);
            String rawPath = parts[1];
            int qIdx = rawPath.indexOf('?');
            String path = qIdx >= 0 ? rawPath.substring(0, qIdx) : rawPath;
            String query = qIdx >= 0 ? rawPath.substring(qIdx + 1) : "";

            String rangeHeader = null;
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    String name = line.substring(0, colon).trim().toLowerCase(Locale.US);
                    if ("range".equals(name)) {
                        rangeHeader = line.substring(colon + 1).trim();
                    }
                }
            }

            OutputStream out = s.getOutputStream();

            if ("OPTIONS".equals(method)) {
                sendSimple(out, 204, "No Content", "text/plain", new byte[0]);
                return;
            }

            if ("/health".equals(path)) {
                sendSimple(out, 200, "OK", "application/json", "{\"ok\":true}".getBytes(StandardCharsets.UTF_8));
                return;
            }

            if (path.startsWith("/api/redgifs/") && ("GET".equals(method) || "HEAD".equals(method))) {
                String id = path.substring("/api/redgifs/".length()).trim().toLowerCase(Locale.US);
                if (!VALID_ID.matcher(id).matches()) {
                    sendJsonError(out, 400, "bad redgifs id");
                    return;
                }
                proxyRedgifs(id, rangeHeader, "HEAD".equals(method), out);
                return;
            }

            if ("/api/twitter/video".equals(path) && ("GET".equals(method) || "HEAD".equals(method))) {
                String targetUrl = extractQueryParam(query, "url");
                if (targetUrl == null || (!targetUrl.startsWith("https://video.twimg.com/") && !targetUrl.startsWith("https://pbs.twimg.com/"))) {
                    sendJsonError(out, 400, "bad twitter video url");
                    return;
                }
                proxyTwitterVideo(targetUrl, rangeHeader, "HEAD".equals(method), out);
                return;
            }

            sendJsonError(out, 404, "not found");
        } catch (IOException ignored) {
        }
    }

    private void proxyTwitterVideo(String target, String rangeHeader, boolean headOnly, OutputStream out) throws IOException {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(target).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", REDGIFS_UA);
            conn.setRequestProperty("Referer", "https://x.com/");
            conn.setRequestProperty("Origin", "https://x.com");
            if (rangeHeader != null && !rangeHeader.isEmpty()) {
                conn.setRequestProperty("Range", rangeHeader);
            }

            int status = conn.getResponseCode();
            if (status != 200 && status != 206 && status != 416) {
                sendJsonError(out, 502, "twitter upstream " + status);
                return;
            }

            String contentType = conn.getHeaderField("Content-Type");
            if (contentType == null || contentType.isEmpty()) contentType = "video/mp4";
            String contentLength = conn.getHeaderField("Content-Length");
            String contentRange = conn.getHeaderField("Content-Range");
            String acceptRanges = conn.getHeaderField("Accept-Ranges");
            if (acceptRanges == null || acceptRanges.isEmpty()) acceptRanges = "bytes";
            String etag = conn.getHeaderField("ETag");
            String lastModified = conn.getHeaderField("Last-Modified");

            StringBuilder headers = new StringBuilder();
            headers.append("HTTP/1.1 ").append(status).append(' ').append(reasonPhrase(status)).append("\r\n");
            headers.append("Content-Type: ").append(contentType).append("\r\n");
            headers.append("Accept-Ranges: ").append(acceptRanges).append("\r\n");
            if (contentLength != null) headers.append("Content-Length: ").append(contentLength).append("\r\n");
            if (contentRange != null) headers.append("Content-Range: ").append(contentRange).append("\r\n");
            if (etag != null) headers.append("ETag: ").append(etag).append("\r\n");
            if (lastModified != null) headers.append("Last-Modified: ").append(lastModified).append("\r\n");
            headers.append("Cache-Control: private, max-age=600\r\n");
            headers.append("Access-Control-Allow-Origin: *\r\n");
            headers.append("Connection: close\r\n\r\n");

            out.write(headers.toString().getBytes(StandardCharsets.US_ASCII));
            if (!headOnly && status != 416) {
                InputStream bodyStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (bodyStream != null) {
                    try (InputStream in = new BufferedInputStream(bodyStream, 65536)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            out.write(buf, 0, n);
                        }
                    }
                }
            }
            out.flush();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String extractQueryParam(String query, String key) {
        if (query == null || query.isEmpty()) return null;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            String k = pair.substring(0, eq);
            if (key.equals(k)) {
                try {
                    return URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                } catch (Exception ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    private void proxyRedgifs(String id, String rangeHeader, boolean headOnly, OutputStream out) throws IOException {
        String target = resolveDirectUrl(id);
        if (target == null) {
            sendJsonError(out, 502, "redgifs lookup failed");
            return;
        }

        HttpURLConnection conn = null;
        try {
            conn = openCdnConnection(target, id, rangeHeader);
            int status = conn.getResponseCode();

            if (status == 401 || status == 403 || status == 410) {
                conn.disconnect();
                directCache.remove(id);
                target = resolveDirectUrl(id);
                if (target == null) {
                    sendJsonError(out, 502, "redgifs lookup failed");
                    return;
                }
                conn = openCdnConnection(target, id, rangeHeader);
                status = conn.getResponseCode();
            }

            if (status != 200 && status != 206 && status != 416) {
                sendJsonError(out, 502, "redgifs upstream " + status);
                return;
            }

            String contentType = conn.getHeaderField("Content-Type");
            if (contentType == null || contentType.isEmpty()) contentType = "video/mp4";
            String contentLength = conn.getHeaderField("Content-Length");
            String contentRange = conn.getHeaderField("Content-Range");
            String acceptRanges = conn.getHeaderField("Accept-Ranges");
            if (acceptRanges == null || acceptRanges.isEmpty()) acceptRanges = "bytes";
            String etag = conn.getHeaderField("ETag");
            String lastModified = conn.getHeaderField("Last-Modified");

            StringBuilder headers = new StringBuilder();
            headers.append("HTTP/1.1 ").append(status).append(' ').append(reasonPhrase(status)).append("\r\n");
            headers.append("Content-Type: ").append(contentType).append("\r\n");
            headers.append("Accept-Ranges: ").append(acceptRanges).append("\r\n");
            if (contentLength != null) headers.append("Content-Length: ").append(contentLength).append("\r\n");
            if (contentRange != null) headers.append("Content-Range: ").append(contentRange).append("\r\n");
            if (etag != null) headers.append("ETag: ").append(etag).append("\r\n");
            if (lastModified != null) headers.append("Last-Modified: ").append(lastModified).append("\r\n");
            headers.append("Cache-Control: private, max-age=600\r\n");
            headers.append("Access-Control-Allow-Origin: *\r\n");
            headers.append("Connection: close\r\n\r\n");

            out.write(headers.toString().getBytes(StandardCharsets.US_ASCII));
            if (!headOnly && status != 416) {
                InputStream bodyStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (bodyStream != null) {
                    try (InputStream in = new BufferedInputStream(bodyStream, 65536)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            out.write(buf, 0, n);
                        }
                    }
                }
            }
            out.flush();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private HttpURLConnection openCdnConnection(String target, String id, String rangeHeader) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(target).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("User-Agent", REDGIFS_UA);
        conn.setRequestProperty("Referer", "https://www.redgifs.com/watch/" + id);
        conn.setRequestProperty("Origin", "https://www.redgifs.com");
        if (rangeHeader != null && !rangeHeader.isEmpty()) {
            conn.setRequestProperty("Range", rangeHeader);
        }
        return conn;
    }

    private String resolveDirectUrl(String id) {
        CachedUrl hit = directCache.get(id);
        long now = System.currentTimeMillis();
        if (hit != null && now - hit.at < DIRECT_TTL_MS) {
            return hit.url;
        }
        String url = fetchRedgifsDirect(id, true);
        if (url != null) {
            if (directCache.size() > 500) directCache.clear();
            directCache.put(id, new CachedUrl(url, System.currentTimeMillis()));
        }
        return url;
    }

    private String fetchRedgifsDirect(String id, boolean allowRetry) {
        String token = getRedgifsToken(false);
        if (token == null) return null;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL("https://api.redgifs.com/v2/gifs/" + id).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Origin", "https://www.redgifs.com");
            conn.setRequestProperty("Referer", "https://www.redgifs.com/watch/" + id);
            conn.setRequestProperty("X-CustomHeader", "https://www.redgifs.com/watch/" + id);
            conn.setRequestProperty("User-Agent", REDGIFS_UA);

            int status = conn.getResponseCode();
            if ((status == 401 || status == 403) && allowRetry) {
                conn.disconnect();
                String fresh = getRedgifsToken(true);
                return fresh != null ? fetchRedgifsDirect(id, false) : null;
            }
            if (status < 200 || status >= 300) return null;
            String body = readAll(conn.getInputStream());
            JSONObject root = new JSONObject(body);
            JSONObject gif = root.optJSONObject("gif");
            if (gif == null) return null;
            JSONObject urls = gif.optJSONObject("urls");
            if (urls == null) return null;
            String hd = urls.optString("hd", "");
            if (!hd.isEmpty()) return hd;
            String sd = urls.optString("sd", "");
            return sd.isEmpty() ? null : sd;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String getRedgifsToken(boolean refresh) {
        synchronized (authLock) {
            long now = System.currentTimeMillis();
            if (refresh) {
                redgifsToken = null;
            } else if (redgifsToken != null && redgifsTokenExp > now + 10_000) {
                return redgifsToken;
            } else if (now - redgifsAuthFailedAt < AUTH_BACKOFF_MS) {
                return null;
            }

            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL("https://api.redgifs.com/v2/auth/temporary").openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("Origin", "https://www.redgifs.com");
                conn.setRequestProperty("Referer", "https://www.redgifs.com/");
                conn.setRequestProperty("User-Agent", REDGIFS_UA);
                if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) {
                    redgifsAuthFailedAt = System.currentTimeMillis();
                    return null;
                }
                String body = readAll(conn.getInputStream());
                String token = new JSONObject(body).optString("token", "");
                if (token.isEmpty()) {
                    redgifsAuthFailedAt = System.currentTimeMillis();
                    return null;
                }
                redgifsToken = token;
                redgifsTokenExp = System.currentTimeMillis() + TOKEN_TTL_MS;
                return token;
            } catch (Exception e) {
                redgifsAuthFailedAt = System.currentTimeMillis();
                return null;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void sendJsonError(OutputStream out, int status, String message) throws IOException {
        byte[] body = ("{\"error\":\"" + message.replace("\"", "") + "\"}").getBytes(StandardCharsets.UTF_8);
        sendSimple(out, status, reasonPhrase(status), "application/json", body);
    }

    private static void sendSimple(OutputStream out, int status, String reason, String contentType, byte[] body)
            throws IOException {
        String header = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n"
                + "Access-Control-Allow-Headers: Range\r\n"
                + "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.US_ASCII));
        if (body.length > 0) out.write(body);
        out.flush();
    }

    private static String reasonPhrase(int status) {
        switch (status) {
            case 200:
                return "OK";
            case 204:
                return "No Content";
            case 206:
                return "Partial Content";
            case 400:
                return "Bad Request";
            case 404:
                return "Not Found";
            case 416:
                return "Range Not Satisfiable";
            case 502:
                return "Bad Gateway";
            default:
                return "OK";
        }
    }
}
