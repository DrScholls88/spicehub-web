package com.spicehub.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Draw behind the system bars on every Android version, not just 15+ where
        // it is forced. The core SystemBars plugin (capacitor.config.json) then pads
        // the WebView or passes env(safe-area-inset-*) through, and pads for the
        // keyboard. Capacitor 9 does this call for you; delete it after upgrading.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
