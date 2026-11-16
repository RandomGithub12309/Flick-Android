package app.flick.saved;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import java.io.IOException;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalServerPlugin.class);
        try {
            LocalServer.ensureStarted();
        } catch (IOException ignored) {
        }
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onDestroy() {
        LocalServer.stopServer();
        super.onDestroy();
    }
}
