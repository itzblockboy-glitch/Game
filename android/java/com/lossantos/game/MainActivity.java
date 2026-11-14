package com.lossantos.game;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * LOS SANTOS — Android host.
 *
 * The game is a WebGL2 app, so the APK is a thin hardware-accelerated WebView
 * shell. The bundled build is served from a loopback HTTP server
 * (see LocalServer) rather than file:// — a real http://localhost origin is the
 * only thing every WebView provider treats as a full, fetch-capable origin.
 */
public class MainActivity extends Activity {
    private static final String TAG = "LosSantos";

    private WebView web;
    private LocalServer server;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        goImmersive();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF06080D);

        // A WebView shell is only as good as the device's WebView provider; if it
        // is missing or disabled, say so instead of dying with an NPE.
        try {
            if (WebView.getCurrentWebViewPackage() == null) {
                throw new IllegalStateException("no WebView provider installed");
            }
        } catch (Throwable t) {
            Log.e(TAG, "WebView unavailable", t);
            root.addView(makeMessage("Android System WebView is missing or disabled.\n"
                    + "Enable it in the Play Store, then reopen Los Santos."));
            setContentView(root);
            return;
        }

        String url = startServerAndUrl(root);
        if (url == null) {
            setContentView(root);
            return;
        }

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        // loopback http:// must stay cleartext-permitted
        if (Build.VERSION.SDK_INT >= 21) s.setBlockNetworkImage(false);

        web.setBackgroundColor(0xFF06080D);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        // hardware layer keeps the WebGL surface on the GPU
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String u) {
                Log.i(TAG, "page finished: " + u);
                // If the bundle never signals a boot (old WebView, blocked module
                // script), ask the page what happened and show it.
                view.evaluateJavascript(
                        "(function(){try{"
                                + "if(window.__game||window.__bootStarted)return 'ok';"
                                + "var s=document.querySelector('script[type=module]');"
                                + "return 'noscript:'+(s?s.src:'none');"
                                + "}catch(e){return 'err:'+e.message}})()",
                        new android.webkit.ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String value) {
                                if (value != null && value.startsWith("\"noscript")) {
                                    Log.w(TAG, "module bundle did not run: " + value);
                                }
                            }
                        });
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String u) {
                return false;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { request.grant(request.getResources()); }
                });
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.requestFocus();
        Log.i(TAG, "loading " + url);
        web.loadUrl(url);
    }

    /**
     * Boots the loopback asset server. Returns the URL to load, or null after
     * showing an error card (the server is the only way the bundle can load).
     */
    private String startServerAndUrl(FrameLayout root) {
        server = new LocalServer(this);
        int port = server.start();
        if (port <= 0) {
            Log.e(TAG, "asset server unavailable");
            root.addView(makeMessage("The game could not unpack its assets.\n"
                    + "Reinstall Los Santos from the APK and try again."));
            return null;
        }
        return "http://127.0.0.1:" + port + "/index.html";
    }

    private android.widget.TextView makeMessage(String text) {
        android.widget.TextView v = new android.widget.TextView(this);
        v.setText(text);
        v.setTextColor(0xFFE8ECF5);
        v.setTextSize(18f);
        v.setGravity(android.view.Gravity.CENTER);
        v.setPadding(48, 48, 48, 48);
        return v;
    }

    private void goImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) goImmersive();
    }

    @Override
    public void onBackPressed() {
        if (web != null) {
            web.evaluateJavascript(
                    "(function(){try{return window.__onAndroidBack?window.__onAndroidBack():false}"
                            + "catch(e){return false}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            if (!"true".equals(value)) finish();
                        }
                    });
        } else {
            finish();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) { web.onPause(); web.pauseTimers(); }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) { web.resumeTimers(); web.onResume(); }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        if (server != null) { server.stop(); server = null; }
        super.onDestroy();
    }
}
