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
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
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
    private String pendingDownloadUrl = null;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerDownloadReceiver();
    }
    
    @Override
    public void onStart() {
        super.onStart();
        
        // Adicionar JavaScript interface após delay
        getBridge().getWebView().postDelayed(() -> {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                // Adicionar interface JavaScript para download de PDF
                webView.addJavascriptInterface(new PdfDownloader(), "AndroidPdfDownloader");
                Log.d(TAG, "JavaScript interface 'AndroidPdfDownloader' adicionada!");
            }
        }, 1000);
    }
    
    /**
     * Interface JavaScript para download de PDF
     * Chamada pelo frontend: window.AndroidPdfDownloader.downloadPdf(url, filename)
     */
    public class PdfDownloader {
        
        @JavascriptInterface
        public void downloadPdf(String url, String filename) {
            Log.d(TAG, "=== downloadPdf chamado ===");
            Log.d(TAG, "URL: " + url);
            Log.d(TAG, "Filename: " + filename);
            
            runOnUiThread(() -> {
                startPdfDownload(url, filename);
            });
        }
        
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }
    }
    
    private void startPdfDownload(String url, String filename) {
        // Verificar permissões para Android < 10
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                pendingDownloadUrl = url;
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        PERMISSION_REQUEST_CODE);
                Toast.makeText(this, "Conceda permissão e tente novamente", Toast.LENGTH_SHORT).show();
                return;
            }
        }
        
        try {
            // Gerar nome do arquivo se não fornecido
            if (filename == null || filename.isEmpty()) {
                filename = generateFileName(url);
            }
            
            // Garantir extensão .pdf
            if (!filename.toLowerCase().endsWith(".pdf")) {
                filename = filename + ".pdf";
            }
            
            Log.d(TAG, "Iniciando download: " + filename);
            
            // Criar request de download
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            
            // Configurações do request
            request.setTitle("Baixando: " + filename);
            request.setDescription("Relatório Icarus");
            request.setMimeType("application/pdf");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.allowScanningByMediaScanner();
            
            // Destino: pasta Downloads pública
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            
            // Iniciar download
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            currentDownloadId = dm.enqueue(request);
            
            Toast.makeText(this, "Baixando PDF...", Toast.LENGTH_SHORT).show();
            Log.d(TAG, "Download iniciado! ID: " + currentDownloadId);
            
        } catch (Exception e) {
            Log.e(TAG, "Erro ao baixar PDF: " + e.getMessage(), e);
            Toast.makeText(this, "Erro ao baixar: " + e.getMessage(), Toast.LENGTH_LONG).show();
            
            // Fallback: abrir no navegador externo
            try {
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(browserIntent);
            } catch (Exception ex) {
                Log.e(TAG, "Fallback falhou", ex);
            }
        }
    }
    
    private String generateFileName(String url) {
        String fileName;
        
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
        
        // Adicionar timestamp
        String timestamp = String.valueOf(System.currentTimeMillis() / 1000);
        return fileName + "_" + timestamp + ".pdf";
    }
    
    private void registerDownloadReceiver() {
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                
                if (downloadId == currentDownloadId && downloadId != -1) {
                    Log.d(TAG, "Download concluído! ID: " + downloadId);
                    
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    DownloadManager.Query query = new DownloadManager.Query();
                    query.setFilterById(downloadId);
                    
                    Cursor cursor = null;
                    try {
                        cursor = dm.query(query);
                        if (cursor != null && cursor.moveToFirst()) {
                            int statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                            int uriIdx = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                            
                            int status = cursor.getInt(statusIdx);
                            String localUri = cursor.getString(uriIdx);
                            
                            Log.d(TAG, "Status: " + status + ", URI: " + localUri);
                            
                            if (status == DownloadManager.STATUS_SUCCESSFUL && localUri != null) {
                                openPdfFile(localUri);
                            } else {
                                runOnUiThread(() -> {
                                    Toast.makeText(context, "Erro no download", Toast.LENGTH_SHORT).show();
                                });
                            }
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Erro ao verificar download", e);
                    } finally {
                        if (cursor != null) {
                            cursor.close();
                        }
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
    
    private void openPdfFile(String uriString) {
        try {
            Log.d(TAG, "Abrindo PDF: " + uriString);
            
            // Converter URI string para File
            Uri fileUri = Uri.parse(uriString);
            String path = fileUri.getPath();
            
            if (path == null) {
                runOnUiThread(() -> {
                    Toast.makeText(this, "PDF salvo em Downloads!", Toast.LENGTH_LONG).show();
                });
                return;
            }
            
            File file = new File(path);
            Log.d(TAG, "Arquivo: " + file.getAbsolutePath() + ", existe: " + file.exists());
            
            // Criar URI com FileProvider para Android 7+
            Uri contentUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                contentUri = FileProvider.getUriForFile(this,
                        getPackageName() + ".fileprovider", file);
            } else {
                contentUri = Uri.fromFile(file);
            }
            
            // Criar intent para abrir PDF
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/pdf");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
            
            // Verificar se existe app para abrir PDF
            if (intent.resolveActivity(getPackageManager()) != null) {
                startActivity(intent);
                runOnUiThread(() -> {
                    Toast.makeText(this, "PDF baixado com sucesso!", Toast.LENGTH_SHORT).show();
                });
            } else {
                // Sem leitor de PDF instalado
                runOnUiThread(() -> {
                    Toast.makeText(this, "PDF salvo em Downloads/" + file.getName() + 
                            "\nInstale um leitor de PDF para abrir.", Toast.LENGTH_LONG).show();
                });
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Erro ao abrir PDF: " + e.getMessage(), e);
            runOnUiThread(() -> {
                Toast.makeText(this, "PDF salvo em Downloads!", Toast.LENGTH_LONG).show();
            });
        }
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Permissão concedida! Tente baixar novamente.", Toast.LENGTH_SHORT).show();
                
                // Tentar download pendente
                if (pendingDownloadUrl != null) {
                    startPdfDownload(pendingDownloadUrl, null);
                    pendingDownloadUrl = null;
                }
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
