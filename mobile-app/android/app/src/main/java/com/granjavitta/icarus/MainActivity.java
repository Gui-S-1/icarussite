package com.granjavitta.icarus;

import android.Manifest;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {
    
    private static final String TAG = "IcarusPDF";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private long currentDownloadId = -1;
    private BroadcastReceiver downloadReceiver;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerDownloadReceiver();
    }
    
    @Override
    public void onStart() {
        super.onStart();
        
        // Configurar WebView após delay para garantir que Capacitor inicializou
        getBridge().getWebView().postDelayed(this::setupWebView, 500);
    }
    
    private void setupWebView() {
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            Log.e(TAG, "WebView não encontrado!");
            return;
        }
        
        // 1. Configurar DownloadListener (para downloads normais)
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Log.d(TAG, "=== DownloadListener ===");
            Log.d(TAG, "URL: " + url);
            Log.d(TAG, "MIME: " + mimeType);
            Log.d(TAG, "Disposition: " + contentDisposition);
            
            if (isPdfDownload(url, mimeType, contentDisposition)) {
                startPdfDownload(url, contentDisposition);
            } else {
                startGenericDownload(url, contentDisposition, mimeType);
            }
        });
        
        // 2. Configurar WebViewClient para interceptar navegação para PDFs
        WebViewClient originalClient = webView.getWebViewClient();
        
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                Log.d(TAG, "=== shouldOverrideUrlLoading ===");
                Log.d(TAG, "URL: " + url);
                
                // Interceptar URLs de PDF do nosso backend
                if (url.contains("/api/pdf/") || url.endsWith(".pdf")) {
                    Log.d(TAG, "PDF detectado! Iniciando download...");
                    startPdfDownload(url, null);
                    return true; // Impede o WebView de navegar
                }
                
                // Deixar o cliente original lidar com outras URLs
                if (originalClient != null) {
                    return originalClient.shouldOverrideUrlLoading(view, request);
                }
                return false;
            }
            
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Log.d(TAG, "=== shouldOverrideUrlLoading (legacy) ===");
                Log.d(TAG, "URL: " + url);
                
                if (url.contains("/api/pdf/") || url.endsWith(".pdf")) {
                    Log.d(TAG, "PDF detectado! Iniciando download...");
                    startPdfDownload(url, null);
                    return true;
                }
                
                if (originalClient != null) {
                    return originalClient.shouldOverrideUrlLoading(view, url);
                }
                return false;
            }
        });
        
        Log.d(TAG, "WebView configurado com sucesso!");
    }
    
    private boolean isPdfDownload(String url, String mimeType, String contentDisposition) {
        if (mimeType != null && mimeType.toLowerCase().contains("pdf")) return true;
        if (url != null && url.toLowerCase().contains(".pdf")) return true;
        if (url != null && url.contains("/api/pdf/")) return true;
        if (contentDisposition != null && contentDisposition.toLowerCase().contains(".pdf")) return true;
        return false;
    }
    
    private void startPdfDownload(String url, String contentDisposition) {
        Log.d(TAG, "=== startPdfDownload ===");
        
        // Verificar permissões (Android < 10)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        PERMISSION_REQUEST_CODE);
                Toast.makeText(this, "Conceda permissão e tente novamente", Toast.LENGTH_SHORT).show();
                return;
            }
        }
        
        try {
            // Gerar nome do arquivo
            String fileName = generateFileName(url, contentDisposition);
            Log.d(TAG, "Arquivo: " + fileName);
            
            // Criar request de download
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            
            // Adicionar cookies (importante para autenticação)
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null && !cookies.isEmpty()) {
                request.addRequestHeader("Cookie", cookies);
            }
            request.addRequestHeader("User-Agent", "IcarusApp/Android");
            
            // Configurações
            request.setTitle("Baixando: " + fileName);
            request.setDescription("Relatório Icarus");
            request.setMimeType("application/pdf");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.allowScanningByMediaScanner();
            
            // Salvar em Downloads
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            
            // Iniciar download
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            currentDownloadId = dm.enqueue(request);
            
            runOnUiThread(() -> {
                Toast.makeText(this, "Baixando PDF...", Toast.LENGTH_SHORT).show();
            });
            
            Log.d(TAG, "Download iniciado! ID: " + currentDownloadId);
            
        } catch (Exception e) {
            Log.e(TAG, "Erro no download: " + e.getMessage(), e);
            runOnUiThread(() -> {
                Toast.makeText(this, "Erro: " + e.getMessage(), Toast.LENGTH_LONG).show();
            });
            
            // Fallback: abrir no navegador externo
            try {
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(browserIntent);
            } catch (Exception ex) {
                Log.e(TAG, "Fallback também falhou", ex);
            }
        }
    }
    
    private void startGenericDownload(String url, String contentDisposition, String mimeType) {
        try {
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Baixando: " + fileName);
            request.setMimeType(mimeType != null ? mimeType : "application/octet-stream");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(request);
            
            Toast.makeText(this, "Baixando arquivo...", Toast.LENGTH_SHORT).show();
            
        } catch (Exception e) {
            Log.e(TAG, "Erro no download genérico: " + e.getMessage(), e);
        }
    }
    
    private String generateFileName(String url, String contentDisposition) {
        String fileName = null;
        
        // 1. Tentar extrair do Content-Disposition
        if (contentDisposition != null && contentDisposition.contains("filename")) {
            try {
                int idx = contentDisposition.indexOf("filename=");
                if (idx >= 0) {
                    fileName = contentDisposition.substring(idx + 9)
                            .replace("\"", "")
                            .replace("'", "")
                            .split(";")[0]
                            .trim();
                }
            } catch (Exception e) {
                Log.w(TAG, "Erro ao parsear Content-Disposition", e);
            }
        }
        
        // 2. Tentar extrair da URL
        if (fileName == null || fileName.isEmpty()) {
            if (url.contains("dashboard")) {
                fileName = "relatorio_dashboard";
            } else if (url.contains("water")) {
                fileName = "relatorio_agua";
            } else if (url.contains("diesel")) {
                fileName = "relatorio_diesel";
            } else if (url.contains("generator")) {
                fileName = "relatorio_gerador";
            } else if (url.contains("orders")) {
                fileName = "relatorio_ordens";
            } else {
                fileName = "relatorio_icarus";
            }
        }
        
        // 3. Garantir extensão .pdf
        if (!fileName.toLowerCase().endsWith(".pdf")) {
            fileName = fileName + ".pdf";
        }
        
        // 4. Adicionar timestamp para evitar sobrescrever
        String baseName = fileName.substring(0, fileName.lastIndexOf('.'));
        String timestamp = String.valueOf(System.currentTimeMillis() / 1000);
        fileName = baseName + "_" + timestamp + ".pdf";
        
        return fileName;
    }
    
    private void registerDownloadReceiver() {
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                
                if (downloadId == currentDownloadId) {
                    Log.d(TAG, "Download concluído! ID: " + downloadId);
                    
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    DownloadManager.Query query = new DownloadManager.Query();
                    query.setFilterById(downloadId);
                    
                    try (Cursor cursor = dm.query(query)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                            int uriIdx = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                            
                            int status = cursor.getInt(statusIdx);
                            String localUri = cursor.getString(uriIdx);
                            
                            Log.d(TAG, "Status: " + status + ", URI: " + localUri);
                            
                            if (status == DownloadManager.STATUS_SUCCESSFUL && localUri != null) {
                                openPdf(localUri);
                            } else {
                                runOnUiThread(() -> {
                                    Toast.makeText(context, "Erro no download", Toast.LENGTH_SHORT).show();
                                });
                            }
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Erro ao verificar download", e);
                    }
                }
            }
        };
        
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
        
        Log.d(TAG, "BroadcastReceiver registrado");
    }
    
    private void openPdf(String uriString) {
        try {
            Log.d(TAG, "Abrindo PDF: " + uriString);
            
            Uri fileUri = Uri.parse(uriString);
            String path = fileUri.getPath();
            
            if (path == null) {
                Toast.makeText(this, "PDF salvo em Downloads!", Toast.LENGTH_LONG).show();
                return;
            }
            
            File file = new File(path);
            
            Uri contentUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                contentUri = FileProvider.getUriForFile(this,
                        getPackageName() + ".fileprovider", file);
            } else {
                contentUri = Uri.fromFile(file);
            }
            
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/pdf");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            
            if (intent.resolveActivity(getPackageManager()) != null) {
                startActivity(intent);
                Toast.makeText(this, "PDF baixado com sucesso!", Toast.LENGTH_SHORT).show();
            } else {
                // Não tem leitor de PDF - mostrar localização
                Toast.makeText(this, "PDF salvo em: Downloads/" + file.getName(), Toast.LENGTH_LONG).show();
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Erro ao abrir PDF: " + e.getMessage(), e);
            Toast.makeText(this, "PDF salvo em Downloads!", Toast.LENGTH_LONG).show();
        }
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Permissão concedida! Tente novamente.", Toast.LENGTH_SHORT).show();
            }
        }
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        if (downloadReceiver != null) {
            try {
                unregisterReceiver(downloadReceiver);
            } catch (Exception e) {
                Log.w(TAG, "Erro ao desregistrar receiver", e);
            }
        }
    }
}
