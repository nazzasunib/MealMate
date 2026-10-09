package com.niduslab.mealmate;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // app-only plugin that saves the website's downloads (PDFs etc.) to Downloads/MealMate
        registerPlugin(DownloaderPlugin.class);
        // tells the website whether the phone is in Dark mode (for the "System" theme)
        registerPlugin(SystemThemePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
