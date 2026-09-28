package app.flick.saved;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Flick's single activity.
 *
 * <p>It exists to install {@link RedgifsWebViewClient} in place of Capacitor's
 * stock one, so redgifs clips stream with the headers their CDN requires
 * without the app needing a server to proxy them.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // BridgeActivity builds the bridge in its own onCreate; it stays null if
        // the WebView failed to inflate, and there is nothing to hook onto then.
        if (bridge == null) return;
        bridge.setWebViewClient(new RedgifsWebViewClient(bridge));
    }
}
