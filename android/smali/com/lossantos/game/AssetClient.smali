.class public Lcom/lossantos/game/AssetClient;
.super Landroid/webkit/WebViewClient;
.source "AssetClient.java"

# Serves the bundled build from a virtual https origin
# (https://appassets.androidplatform.net/assets/game/...) by intercepting every
# request and streaming it out of the APK's assets/ directory. This is required
# because Chromium's WebView refuses fetch()/XHR on file:// URLs, which the game
# needs to load its glTF models, manifest and draco decoder.

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V
    return-void
.end method

.method private static mimeType(Ljava/lang/String;)Ljava/lang/String;
    .locals 1

    const-string v0, ".html"
    invoke-virtual {p1, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :m_html
    const-string v0, "text/html"
    return-object v0

    :m_html
    const-string v0, ".js"
    invoke-virtual {p1, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :m_js
    const-string v0, "application/javascript"
    return-object v0

    :m_js
    const-string v0, ".css"
    invoke-virtual {p1, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :m_css
    const-string v0, "text/css"
    return-object v0

    :m_css
    const-string v0, ".json"
    invoke-virtual {p1, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :m_json
    const-string v0, "application/json"
    return-object v0

    :m_json
    const-string v0, ".wasm"
    invoke-virtual {p1, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :m_wasm
    const-string v0, "application/wasm"
    return-object v0

    :m_wasm
    const-string v0, ".glb"
    invoke-virtual {p1, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :m_glb
    const-string v0, "model/gltf-binary"
    return-object v0

    :m_glb
    const-string v0, ".png"
    invoke-virtual {p1, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :m_png
    const-string v0, "image/png"
    return-object v0

    :m_png
    const-string v0, ".webmanifest"
    invoke-virtual {p1, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :m_default
    const-string v0, "application/manifest+json"
    return-object v0

    :m_default
    const-string v0, "application/octet-stream"
    return-object v0
.end method

.method public shouldInterceptRequest(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Landroid/webkit/WebResourceResponse;
    .locals 9

    const/4 v8, 0x0

    :try_start_0
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;
    move-result-object v0
    invoke-virtual {v0}, Landroid/net/Uri;->getPath()Ljava/lang/String;
    move-result-object v1
    if-nez v1, :try_end_0

    # path -> asset path
    const-string v2, "/assets/game/"
    invoke-virtual {v1, v2}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z
    move-result v3
    if-eqz v3, :path_root

    # /assets/game/x -> x
    const-string v2, "/assets/game/"
    invoke-virtual {v2}, Ljava/lang/String;->length()I
    move-result v3
    invoke-virtual {v1, v3}, Ljava/lang/String;->substring(I)Ljava/lang/String;
    move-result-object v1
    goto :have_path

    # any other absolute path (e.g. /models/a.glb) is relative to the game root
    :path_root
    const-string v2, "game"
    invoke-static {v2}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;
    move-result-object v2
    invoke-static {v1}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;
    move-result-object v1
    invoke-virtual {v2, v1}, Ljava/lang/String;->concat(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v1

    :have_path
    const-string v2, ""
    invoke-virtual {v1, v2}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v3
    if-eqz v3, :not_empty
    const-string v1, "index.html"
    :not_empty

    invoke-static {v1}, Lcom/lossantos/game/AssetClient;->mimeType(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v4

    invoke-virtual {p1}, Landroid/webkit/WebView;->getContext()Landroid/content/Context;
    move-result-object v5
    invoke-virtual {v5}, Landroid/content/Context;->getAssets()Landroid/content/res/AssetManager;
    move-result-object v5
    invoke-virtual {v5, v1}, Landroid/content/res/AssetManager;->open(Ljava/lang/String;)Ljava/io/InputStream;
    move-result-object v6

    new-instance v7, Landroid/webkit/WebResourceResponse;
    const-string v0, "UTF-8"
    invoke-direct {v7, v4, v0, v6}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;Ljava/io/InputStream;)V
    goto :done
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    move-exception v0
    move-object v7, v8

    :done
    return-object v7
.end method

.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z
    .locals 2
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;
    move-result-object v0
    invoke-virtual {v0}, Landroid/net/Uri;->getHost()Ljava/lang/String;
    move-result-object v0
    const-string v1, "appassets.androidplatform.net"
    invoke-virtual {v1, v0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    return v0
.end method
