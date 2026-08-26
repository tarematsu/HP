package com.tarematsu.videoscraper;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.res.Configuration;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.text.InputType;
import android.view.Surface;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.util.Locale;
import java.util.concurrent.Executor;

@SuppressWarnings("deprecation")
public final class MainActivity extends Activity {
    private static final String PREFS = "videoscraper_app";
    private static final String KEY_BASE_URL = "base_url";
    private static final String DEFAULT_URL = "https://example.workers.dev";

    private WebView webView;
    private AlertDialog urlDialog;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private CancellationSignal cancellationSignal;
    private boolean authenticated;
    private boolean authPromptActive;
    private boolean foreground;
    private boolean clearHistoryAfterLoad;
    private volatile boolean landscape;
    private volatile int displayRotationDegrees;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        refreshNativeOrientation();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowManager.LayoutParams p = getWindow().getAttributes();
        p.screenBrightness = 1.0f;
        getWindow().setAttributes(p);
        setupWebView();
        hideSystemUi();
    }

    private void setupWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(0xff000000);
        webView.setFilterTouchesWhenObscured(true);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSaveFormData(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new NativeBridge(), "VideoPlayerNative");
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());
        setContentView(webView);
        webView.requestFocus();
    }

    private void showAuthenticationPrompt() {
        if (!foreground || authenticated || authPromptActive || isFinishing() || isDestroyed()) return;
        authPromptActive = true;
        cancellationSignal = new CancellationSignal();
        Executor executor = getMainExecutor();
        BiometricPrompt.Builder b = new BiometricPrompt.Builder(this)
                .setTitle("VideoPlayer")
                .setSubtitle("Cloudflare");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            b.setDeviceCredentialAllowed(true);
        } else {
            b.setNegativeButton(getString(android.R.string.cancel), executor, (d, w) -> finish());
        }
        try {
            b.build().authenticate(cancellationSignal, executor, new AuthCallback());
        } catch (RuntimeException e) {
            authPromptActive = false;
            finish();
        }
    }

    private void loadConfiguredUrl() {
        String url = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_BASE_URL, DEFAULT_URL);
        url = url == null ? "" : url.trim();
        if (!validHttps(url) || DEFAULT_URL.equals(url)) {
            showUrlDialog();
            return;
        }
        clearHistoryAfterLoad = true;
        webView.loadUrl(url);
    }

    private void showUrlDialog() {
        if (!foreground || isFinishing() || isDestroyed()) return;
        if (urlDialog != null && urlDialog.isShowing()) return;
        String current = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_BASE_URL, DEFAULT_URL);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("HTTPS");
        input.setText(current == null ? "" : current);
        input.selectAll();
        urlDialog = new AlertDialog.Builder(this)
                .setTitle("VideoPlayer URL")
                .setMessage("HTTPS URL")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton(android.R.string.ok, (d, w) -> {
                    String value = input.getText().toString().trim();
                    if (!validHttps(value)) {
                        Toast.makeText(this, "HTTPS URL", Toast.LENGTH_SHORT).show();
                        webView.post(this::showUrlDialog);
                        return;
                    }
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_BASE_URL, value).apply();
                    clearHistoryAfterLoad = true;
                    webView.loadUrl(value);
                })
                .setNegativeButton(android.R.string.cancel, (d, w) -> {
                    String saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_BASE_URL, DEFAULT_URL);
                    if (!validHttps(saved) || DEFAULT_URL.equals(saved)) finish();
                })
                .create();
        urlDialog.show();
    }

    private static boolean validHttps(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        Uri u = Uri.parse(value.trim());
        return "https".equalsIgnoreCase(u.getScheme()) && u.getHost() != null && !u.getHost().trim().isEmpty();
    }

    private boolean isAllowedNavigation(String value) {
        if ("about:blank".equalsIgnoreCase(value)) return true;
        if (!validHttps(value)) return false;
        String configured = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_BASE_URL, DEFAULT_URL);
        if (!validHttps(configured)) return false;
        Uri target = Uri.parse(value);
        Uri base = Uri.parse(configured);
        String th = target.getHost();
        String bh = base.getHost();
        if (th == null || bh == null || !th.toLowerCase(Locale.ROOT).equals(bh.toLowerCase(Locale.ROOT))) return false;
        int tp = target.getPort() < 0 ? 443 : target.getPort();
        int bp = base.getPort() < 0 ? 443 : base.getPort();
        return tp == bp;
    }

    private void showCustomView(View view, WebChromeClient.CustomViewCallback callback) {
        if (customView != null) {
            callback.onCustomViewHidden();
            return;
        }
        customView = view;
        customViewCallback = callback;
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        view.setBackgroundColor(0xff000000);
        decor.addView(view, lp);
        webView.setVisibility(View.INVISIBLE);
        hideSystemUi();
    }

    private void hideCustomView() {
        if (customView == null) return;
        if (customView.getParent() instanceof ViewGroup) ((ViewGroup) customView.getParent()).removeView(customView);
        customView = null;
        if (webView != null) webView.setVisibility(View.VISIBLE);
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
        hideSystemUi();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private int readDisplayRotationDegrees() {
        int rotation = getWindowManager().getDefaultDisplay().getRotation();
        if (rotation == Surface.ROTATION_90) return 90;
        if (rotation == Surface.ROTATION_180) return 180;
        if (rotation == Surface.ROTATION_270) return 270;
        return 0;
    }

    private void refreshNativeOrientation() {
        displayRotationDegrees = readDisplayRotationDegrees();
        landscape = displayRotationDegrees == 90 || displayRotationDegrees == 270;
    }

    private void notifyWebOrientationChanged() {
        if (webView == null) return;
        webView.post(() -> {
            if (webView == null) return;
            webView.requestLayout();
            webView.invalidate();
            webView.evaluateJavascript("window.dispatchEvent(new Event('resize'))", null);
        });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        refreshNativeOrientation();
        hideSystemUi();
        notifyWebOrientationChanged();
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        refreshNativeOrientation();
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
        }
        hideSystemUi();
        showAuthenticationPrompt();
    }

    @Override
    protected void onPause() {
        foreground = false;
        authenticated = false;
        authPromptActive = false;
        if (cancellationSignal != null) {
            cancellationSignal.cancel();
            cancellationSignal = null;
        }
        if (webView != null) {
            webView.evaluateJavascript("javascript:(()=>{document.querySelectorAll('video,audio').forEach(v=>v.pause())})()", null);
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else if (authenticated) {
            showUrlDialog();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            refreshNativeOrientation();
            hideSystemUi();
            notifyWebOrientationChanged();
            if (foreground && !authenticated) showAuthenticationPrompt();
        }
    }

    @Override
    protected void onDestroy() {
        if (urlDialog != null) urlDialog.dismiss();
        if (cancellationSignal != null) cancellationSignal.cancel();
        hideCustomView();
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class NativeBridge {
        @JavascriptInterface
        public boolean isLandscape() {
            return landscape;
        }

        @JavascriptInterface
        public int getDisplayRotationDegrees() {
            return displayRotationDegrees;
        }

        @JavascriptInterface
        public boolean usesPortraitFixedTouchAxes() {
            return true;
        }
    }

    private final class AuthCallback extends BiometricPrompt.AuthenticationCallback {
        @Override
        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
            authPromptActive = false;
            cancellationSignal = null;
            authenticated = true;
            if (foreground && !isFinishing() && !isDestroyed()) loadConfiguredUrl();
        }

        @Override
        public void onAuthenticationFailed() {
        }

        @Override
        public void onAuthenticationError(int code, CharSequence message) {
            authPromptActive = false;
            cancellationSignal = null;
            if (!authenticated && foreground && !isFinishing()) finish();
        }
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !isAllowedNavigation(request.getUrl().toString());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !isAllowedNavigation(url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (clearHistoryAfterLoad) {
                view.clearHistory();
                clearHistoryAfterLoad = false;
            }
            notifyWebOrientationChanged();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view != null) view.destroy();
            webView = null;
            recreate();
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            showCustomView(view, callback);
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }
    }
}
