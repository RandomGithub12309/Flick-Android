package app.flick.saved;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

import java.io.IOException;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalServerPlugin.class);
        registerPlugin(TwitterAuthPlugin.class);
        try {
            LocalServer.ensureStarted();
        } catch (IOException ignored) {
        }
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings webSettings = getBridge().getWebView().getSettings();
            webSettings.setMediaPlaybackRequiresUserGesture(false);
        }

        Window window = getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            window.setStatusBarColor(Color.parseColor("#09090b"));
            window.setNavigationBarColor(Color.parseColor("#09090b"));
        }
    }

    @Override
    public void onDestroy() {
        LocalServer.stopServer();
        super.onDestroy();
    }
}
