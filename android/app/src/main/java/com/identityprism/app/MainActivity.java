package com.identityprism.app;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void dispatchWindowEvent(String eventName) {
        WebView currentWebView = getBridge().getWebView();
        currentWebView.post(() -> currentWebView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('" + eventName + "'))",
            null
        ));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SeedVaultPlugin.class);
        super.onCreate(savedInstanceState);

        // Disable Android WebView force-dark mode — it darkens the entire card/UI
        WebView webView = getBridge().getWebView();
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            webView.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.getSettings(), false);
        } else if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(webView.getSettings(), WebSettingsCompat.FORCE_DARK_OFF);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dispatchWindowEvent("identityprism:nativeBack");
            }
        });
    }

    @Override
    public void onPause() {
        dispatchWindowEvent("identityprism:nativePause");
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        dispatchWindowEvent("identityprism:nativeResume");
    }
}
