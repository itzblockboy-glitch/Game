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
 * shell serving the bundled build from a virtual https origin (see AssetClient).
 * Everything ships inside the APK: it plays fully offline, and multiplayer +
 * WebRTC voice connect only when the device has a network.
 */
public class MainActivity extends Activity {
    private static final String TAG = "LosSantos";
    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/game/index.html";

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        // keep the screen on, go edge-to-edge/fullscreen
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        goImmersive();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);

        // A WebView shell is only as good as the device's WebView provider; if it is
        // missing or disabled, say so instead of dying with a NullPointerException.
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
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        web.setBackgroundColor(0xFF000000);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        // hardware layer keeps the WebGL surface on the GPU
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // grant microphone (voice chat); never touches the camera
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
        web.loadUrl(START_URL);
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
        // the game decides first: close chat/hub, else pause; exit only if it says no
        if (web != null) {
            web.evaluateJavascript(
                    "(function(){try{return window.__onAndroidBack?window.__onAndroidBack():false}"
                            + "catch(e){return false}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String value) {
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
        super.onDestroy();
    }
}
