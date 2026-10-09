package com.niduslab.mealmate;

import android.content.res.Configuration;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the website whether the phone itself is in Dark mode.
 *
 * Why: the app's "System" theme follows the phone. Inside the app's WebView
 * the CSS media query (prefers-color-scheme) is not always reliable, so the
 * website asks the phone directly with
 * window.Capacitor.Plugins.SystemTheme.get() → { dark: true/false }
 * and listens for "change" (fired when the phone switches Light/Dark and
 * whenever the app comes back to the front).
 */
@CapacitorPlugin(name = "SystemTheme")
public class SystemThemePlugin extends Plugin {

    private static boolean isNight(Configuration c) {
        return c != null && (c.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private JSObject state(Configuration c) {
        JSObject r = new JSObject();
        r.put("dark", isNight(c));
        return r;
    }

    private Configuration current() {
        if (getActivity() != null) return getActivity().getResources().getConfiguration();
        return getContext().getResources().getConfiguration();
    }

    @PluginMethod
    public void get(PluginCall call) {
        call.resolve(state(current()));
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        notifyListeners("change", state(newConfig));
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("change", state(current()));
    }
}
