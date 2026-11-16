package app.flick.saved;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;

@CapacitorPlugin(name = "LocalServer")
public class LocalServerPlugin extends Plugin {
    @PluginMethod
    public void getPort(PluginCall call) {
        try {
            int port = LocalServer.ensureStarted();
            JSObject ret = new JSObject();
            ret.put("port", port);
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Failed to start local server", e);
        }
    }
}
