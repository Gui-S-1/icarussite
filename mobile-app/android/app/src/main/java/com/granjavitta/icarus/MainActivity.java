package com.granjavitta.icarus;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Registrar plugin ANTES de super.onCreate()
        registerPlugin(PdfDownloaderPlugin.class);
        
        super.onCreate(savedInstanceState);
    }
}
