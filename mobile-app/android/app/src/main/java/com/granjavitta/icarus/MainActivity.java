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
import android.webkit.WebView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {
    
    private static final String TAG = "IcarusMain";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private long downloadId = -1;
    private BroadcastReceiver downloadReceiver;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Registrar receiver para download completo
        registerDownloadReceiver();
    }
    
    @Override
    public void onStart() {
        super.onStart();
        
        // Configurar DownloadListener no WebView após Capacitor inicializar
        getBridge().getWebView().postDelayed(() -> {
            setupDownloadListener();
        }, 1000);
    }
    
    private void setupDownloadListener() {
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            Log.e(TAG, "WebView não encontrado");
            return;
        }
        
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Log.d(TAG, "Download interceptado:");
            Log.d(TAG, "  URL: " + url);
            Log.d(TAG, "  MimeType: " + mimeType);
            Log.d(TAG, "  ContentDisposition: " + contentDisposition);
            
            // Verificar se é PDF
            if (mimeType != null && mimeType.contains("pdf")) {
                downloadPDF(url, contentDisposition, mimeType);
            } else if (url.endsWith(".pdf") || (contentDisposition != null && contentDisposition.contains(".pdf"))) {
                downloadPDF(url, contentDisposition, "application/pdf");
            } else if (mimeType != null && mimeType.contains("application/vnd.android.package-archive")) {
                // APK - baixar e instalar
                downloadAPK(url, contentDisposition);
            } else {
                // Outros arquivos - baixar normalmente
                downloadFile(url, contentDisposition, mimeType);
            }
        });
        
        Log.d(TAG, "DownloadListener configurado com sucesso");
    }
    
    private void downloadPDF(String url, String contentDisposition, String mimeType) {
        // Verificar permissões para Android < 10
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
            // Extrair nome do arquivo
            String fileName = extractFileName(url, contentDisposition, "relatorio.pdf");
            
            // Configurar DownloadManager
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            
            // Headers
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) {
                request.addRequestHeader("Cookie", cookies);
            }
            request.addRequestHeader("User-Agent", "IcarusApp/Android");
            
            // Configurações do download
            request.setTitle("Baixando: " + fileName);
            request.setDescription("Relatório Icarus");
            request.setMimeType(mimeType);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.allowScanningByMediaScanner();
            
            // Destino: pasta Downloads
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            
            // Iniciar download
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            downloadId = dm.enqueue(request);
            
            Toast.makeText(this, "Baixando PDF...", Toast.LENGTH_SHORT).show();
            Log.d(TAG, "Download iniciado: ID=" + downloadId + ", arquivo=" + fileName);
            
        } catch (Exception e) {
            Log.e(TAG, "Erro ao baixar PDF: " + e.getMessage(), e);
            Toast.makeText(this, "Erro ao baixar: " + e.getMessage(), Toast.LENGTH_LONG).show();
            
            // Fallback: abrir no navegador externo
            try {
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(browserIntent);
            } catch (Exception ex) {
                Log.e(TAG, "Fallback também falhou", ex);
            }
        }
    }
    
    private void downloadAPK(String url, String contentDisposition) {
        try {
            String fileName = extractFileName(url, contentDisposition, "icarus_update.apk");
            
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Atualizando Icarus");
            request.setDescription("Baixando nova versão do app");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            downloadId = dm.enqueue(request);
            
            Toast.makeText(this, "Baixando atualização...", Toast.LENGTH_SHORT).show();
            
        } catch (Exception e) {
            Log.e(TAG, "Erro ao baixar APK: " + e.getMessage(), e);
            Toast.makeText(this, "Erro ao baixar atualização", Toast.LENGTH_LONG).show();
        }
    }
    
    private void downloadFile(String url, String contentDisposition, String mimeType) {
        try {
            String fileName = extractFileName(url, contentDisposition, "download");
            
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Baixando: " + fileName);
            request.setMimeType(mimeType != null ? mimeType : "application/octet-stream");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(request);
            
            Toast.makeText(this, "Baixando arquivo...", Toast.LENGTH_SHORT).show();
            
        } catch (Exception e) {
            Log.e(TAG, "Erro ao baixar arquivo: " + e.getMessage(), e);
        }
    }
    
    private String extractFileName(String url, String contentDisposition, String defaultName) {
        String fileName = null;
        
        // Tentar extrair do Content-Disposition
        if (contentDisposition != null && !contentDisposition.isEmpty()) {
            // filename="nome.pdf" ou filename*=UTF-8''nome.pdf
            if (contentDisposition.contains("filename=")) {
                int idx = contentDisposition.indexOf("filename=");
                fileName = contentDisposition.substring(idx + 9);
                fileName = fileName.replace("\"", "").replace("'", "").trim();
                
                // Remover parâmetros extras após ;
                if (fileName.contains(";")) {
                    fileName = fileName.substring(0, fileName.indexOf(";"));
                }
            }
        }
        
        // Se não conseguiu, tentar da URL
        if (fileName == null || fileName.isEmpty()) {
            fileName = URLUtil.guessFileName(url, contentDisposition, "application/pdf");
        }
        
        // Fallback
        if (fileName == null || fileName.isEmpty()) {
            fileName = defaultName;
        }
        
        // Garantir que tem extensão
        if (!fileName.contains(".")) {
            fileName = fileName + ".pdf";
        }
        
        // Adicionar timestamp para evitar conflitos
        String baseName = fileName.substring(0, fileName.lastIndexOf('.'));
        String extension = fileName.substring(fileName.lastIndexOf('.'));
        fileName = baseName + "_" + System.currentTimeMillis() + extension;
        
        return fileName;
    }
    
    private void registerDownloadReceiver() {
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                
                if (id == downloadId) {
                    Log.d(TAG, "Download concluído: ID=" + id);
                    
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    DownloadManager.Query query = new DownloadManager.Query();
                    query.setFilterById(id);
                    
                    Cursor cursor = dm.query(query);
                    if (cursor != null && cursor.moveToFirst()) {
                        int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                        int uriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                        int mimeIndex = cursor.getColumnIndex(DownloadManager.COLUMN_MEDIA_TYPE);
                        
                        int status = cursor.getInt(statusIndex);
                        String localUri = cursor.getString(uriIndex);
                        String mimeType = cursor.getString(mimeIndex);
                        
                        if (status == DownloadManager.STATUS_SUCCESSFUL && localUri != null) {
                            Log.d(TAG, "Arquivo salvo em: " + localUri);
                            Log.d(TAG, "MimeType: " + mimeType);
                            
                            // Abrir PDF automaticamente
                            if (mimeType != null && mimeType.contains("pdf")) {
                                openPDF(localUri);
                            } else if (mimeType != null && mimeType.contains("android.package-archive")) {
                                // Abrir APK para instalação
                                openAPK(localUri);
                            } else {
                                Toast.makeText(context, "Download concluído!", Toast.LENGTH_SHORT).show();
                            }
                        } else {
                            Toast.makeText(context, "Erro no download", Toast.LENGTH_SHORT).show();
                        }
                        cursor.close();
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
    }
    
    private void openPDF(String uriString) {
        try {
            Uri uri = Uri.parse(uriString);
            File file = new File(uri.getPath());
            
            Uri contentUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Android 7+ precisa de FileProvider
                contentUri = FileProvider.getUriForFile(this,
                        getPackageName() + ".fileprovider",
                        file);
            } else {
                contentUri = Uri.fromFile(file);
            }
            
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/pdf");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            
            // Verificar se há app para abrir PDF
            if (intent.resolveActivity(getPackageManager()) != null) {
                startActivity(intent);
                Log.d(TAG, "PDF aberto com sucesso");
            } else {
                Toast.makeText(this, "PDF salvo em Downloads", Toast.LENGTH_LONG).show();
                Log.w(TAG, "Nenhum app de PDF instalado");
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Erro ao abrir PDF: " + e.getMessage(), e);
            Toast.makeText(this, "PDF salvo em Downloads", Toast.LENGTH_SHORT).show();
        }
    }
    
    private void openAPK(String uriString) {
        try {
            Uri uri = Uri.parse(uriString);
            File file = new File(uri.getPath());
            
            Uri contentUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                contentUri = FileProvider.getUriForFile(this,
                        getPackageName() + ".fileprovider",
                        file);
            } else {
                contentUri = Uri.fromFile(file);
            }
            
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            
            startActivity(intent);
            
        } catch (Exception e) {
            Log.e(TAG, "Erro ao abrir APK: " + e.getMessage(), e);
            Toast.makeText(this, "APK salvo em Downloads. Instale manualmente.", Toast.LENGTH_LONG).show();
        }
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Permissão concedida! Tente novamente.", Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, "Permissão negada. Downloads podem falhar.", Toast.LENGTH_LONG).show();
            }
        }
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        
        // Desregistrar receiver
        if (downloadReceiver != null) {
            try {
                unregisterReceiver(downloadReceiver);
            } catch (Exception e) {
                Log.e(TAG, "Erro ao desregistrar receiver", e);
            }
        }
    }
}
