package com.lossantos.game;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;

/**
 * Serves the bundled build from https://appassets.androidplatform.net/assets/game/…
 *
 * A file:// page cannot fetch() (Chromium blocks the URL scheme), and the game
 * needs fetch for its glTF models, manifest and draco decoder — so requests to
 * the virtual origin are intercepted here and streamed straight out of assets/.
 * Any request that can't be resolved returns null, which lets Chromium handle it
 * normally (that is how the remote multiplayer socket keeps working).
 */
public class AssetClient extends WebViewClient {
    static final String HOST = "appassets.androidplatform.net";
    private static final String ROOT = "/assets/game/";

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (path == null) return null;

        String asset;
        if (path.startsWith(ROOT)) {
            asset = path.substring(ROOT.length());
        } else if (path.startsWith("/")) {
            // absolute /models/… etc, resolved against the game root
            asset = "game" + path;
        } else {
            return null;
        }
        if (asset.isEmpty()) asset = "index.html";

        try {
            InputStream in = view.getContext().getAssets().open(asset);
            WebResourceResponse res = new WebResourceResponse(mime(asset), "UTF-8", in);
            res.setStatusCodeAndReasonPhrase(200, "OK");
            return res;
        } catch (IOException e) {
            return null;
        }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        // never hand navigation to the system browser: everything the game needs is
        // either bundled (served above) or a network request Chromium handles itself
        return false;
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".glb")) return "model/gltf-binary";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }
}
