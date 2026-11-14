package com.lossantos.game;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves the bundled build from http://127.0.0.1:&lt;port&gt;/.
 *
 * Why not file:// or a request interceptor?
 *  • file:// pages cannot fetch() — the game needs fetch for its glTF models,
 *    the manifest and the draco decoder.
 *  • shouldInterceptRequest() responses are not always treated as a secure,
 *    fully-featured origin by every WebView provider, and opaque responses break
 *    module scripts in some builds.
 * A real loopback HTTP server gives the page an ordinary http://localhost origin,
 * which every Chromium build accepts, supports fetch(), and needs no TLS. It only
 * ever binds to the loopback interface, so nothing is exposed off-device.
 */
public class LocalServer implements Runnable {
    private static final String TAG = "LosSantos";

    private final AssetManager assets;
    private ServerSocket server;
    private Thread thread;
    private volatile boolean running;
    private int port = -1;

    public LocalServer(Context context) {
        this.assets = context.getAssets();
    }

    /** Starts the server and blocks briefly until it is accepting connections. */
    public synchronized int start() {
        if (port > 0) return port;
        try {
            // Port 0 = let the OS pick a free port, so we never clash with another app.
            server = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
            port = server.getLocalPort();
            running = true;
            thread = new Thread(this, "los-santos-assets");
            thread.setDaemon(true);
            thread.start();
            Log.i(TAG, "asset server on http://127.0.0.1:" + port + "/");
            return port;
        } catch (IOException e) {
            Log.e(TAG, "could not start asset server", e);
            return -1;
        }
    }

    public void stop() {
        running = false;
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
        }
        server = null;
        port = -1;
    }

    @Override
    public void run() {
        while (running) {
            try {
                Socket client = server.accept();
                // Requests are tiny and serialised loading is fine for a game shell.
                try {
                    handle(client);
                } finally {
                    try { client.close(); } catch (IOException ignored) { }
                }
            } catch (IOException e) {
                if (running) Log.w(TAG, "accept failed", e);
            }
        }
    }

    private void handle(Socket client) {
        try {
            InputStream raw = client.getInputStream();
            String requestLine = readLine(raw);
            if (requestLine == null) return;
            // Drain headers.
            String line;
            do {
                line = readLine(raw);
            } while (line != null && !line.isEmpty());

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String target = parts[1];

            // strip query string / fragment
            int q = target.indexOf('?');
            if (q >= 0) target = target.substring(0, q);
            int h = target.indexOf('#');
            if (h >= 0) target = target.substring(0, h);
            if (target.startsWith("/")) target = target.substring(1);
            if (target.isEmpty()) target = "index.html";

            // assets live under assets/game/ inside the APK
            String assetPath = "game/" + target;
            byte[] body;
            String mime = mime(target);
            try {
                body = readFully(assets.open(assetPath));
            } catch (IOException e) {
                // Unknown path: do not 404 hard — the SPA has a single entry point
                if (!target.contains(".")) {
                    try {
                        body = readFully(assets.open("game/index.html"));
                        mime = "text/html";
                    } catch (IOException e2) {
                        sendError(client);
                        return;
                    }
                } else {
                    sendError(client);
                    return;
                }
            }

            String head = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: " + mime + "\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Cache-Control: no-cache\r\n"
                    + // required for WebRTC / getDisplayMedia style features and
                    // generally lets the page be treated as a full-power origin
                    "Cross-Origin-Opener-Policy: same-origin\r\n"
                    + "Cross-Origin-Embedder-Policy: require-corp\r\n"
                    + "Connection: close\r\n\r\n";

            OutputStream out = client.getOutputStream();
            out.write(head.getBytes("UTF-8"));
            out.write(body);
            out.flush();
        } catch (Exception e) {
            Log.w(TAG, "failed to serve request", e);
            sendError(client);
        }
    }

    private void sendError(Socket client) {
        try {
            String msg = "not found";
            OutputStream out = client.getOutputStream();
            out.write(("HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: "
                    + msg.length() + "\r\nConnection: close\r\n\r\n" + msg).getBytes("UTF-8"));
            out.flush();
        } catch (IOException ignored) {
        }
    }

    private byte[] readFully(InputStream in) throws IOException {
        try {
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream(Math.max(1024, in.available()));
            byte[] chunk = new byte[32 * 1024];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return buf.toByteArray();
        } finally {
            try { in.close(); } catch (IOException ignored) { }
        }
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder(80);
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 4096) break;
        }
        return sb.length() == 0 && c == -1 ? null : sb.toString();
    }

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js", "text/javascript; charset=utf-8");
        MIME.put("mjs", "text/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("webmanifest", "application/manifest+json; charset=utf-8");
        MIME.put("wasm", "application/wasm");
        MIME.put("glb", "model/gltf-binary");
        MIME.put("gltf", "model/gltf+json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("svg", "image/svg+xml");
        MIME.put("bin", "application/octet-stream");
        MIME.put("ogg", "audio/ogg");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("ttf", "font/ttf");
        MIME.put("woff2", "font/woff2");
    }

    static String mime(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase(Locale.US);
        String found = MIME.get(ext);
        return found != null ? found : "application/octet-stream";
    }
}
