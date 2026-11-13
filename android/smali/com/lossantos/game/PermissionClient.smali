.class public Lcom/lossantos/game/PermissionClient;
.super Landroid/webkit/WebChromeClient;
.source "PermissionClient.java"

.field final synthetic this$0:Lcom/lossantos/game/MainActivity;

.method public constructor <init>(Lcom/lossantos/game/MainActivity;)V
    .locals 0
    iput-object p1, p0, Lcom/lossantos/game/PermissionClient;->this$0:Lcom/lossantos/game/MainActivity;
    invoke-direct {p0}, Landroid/webkit/WebChromeClient;-><init>()V
    return-void
.end method

.method public onPermissionRequest(Landroid/webkit/PermissionRequest;)V
    .locals 1
    invoke-virtual {p1}, Landroid/webkit/PermissionRequest;->getResources()[Ljava/lang/String;
    move-result-object v0
    invoke-virtual {p1, v0}, Landroid/webkit/PermissionRequest;->grant([Ljava/lang/String;)V
    return-void
.end method

.method public onConsoleMessage(Landroid/webkit/ConsoleMessage;)Z
    .locals 2
    invoke-virtual {p1}, Landroid/webkit/ConsoleMessage;->message()Ljava/lang/String;
    move-result-object v0
    const-string v1, "LosSantos"
    invoke-static {v1, v0}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I
    const/4 v0, 0x1
    return v0
.end method
