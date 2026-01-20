package com.granjavitta.icarus;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "PdfDownloader")
public class PdfDownloaderPlugin extends Plugin {

    private static final String TAG = "PdfDownloaderPlugin";
    private long currentDownloadId = -1;
    private PluginCall savedCall = null;

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String filename = call.getString("filename", "relatorio.pdf");

        Log.d(TAG, "=== download() chamado ===");
        Log.d(TAG, "URL: " + url);
        Log.d(TAG, "Filename: " + filename);

        if (url == null || url.isEmpty()) {
            call.reject("URL é obrigatória");
            return;
        }

        // Garantir extensão .pdf
        if (!filename.toLowerCase().endsWith(".pdf")) {
            filename = filename + ".pdf";
        }

        try {
            // Mostrar toast
            final String finalFilename = filename;
            getActivity().runOnUiThread(() -> {
                Toast.makeText(getContext(), "📥 Baixando PDF...", Toast.LENGTH_SHORT).show();
            });

            // Criar request de download
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));

            // Headers importantes
            request.addRequestHeader("Accept", "application/pdf");
            
            // Configurações
            request.setTitle("Baixando: " + filename);
            request.setDescription("Relatório Icarus - Granja Vitta");
            request.setMimeType("application/pdf");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.allowScanningByMediaScanner();

            // Destino: pasta Downloads
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);

            // Iniciar download
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            currentDownloadId = dm.enqueue(request);

            Log.d(TAG, "Download iniciado! ID: " + currentDownloadId);

            // Salvar call para responder depois
            savedCall = call;

            // Registrar receiver para quando download terminar
            registerDownloadReceiver();

        } catch (Exception e) {
            Log.e(TAG, "Erro ao baixar: " + e.getMessage(), e);
            call.reject("Erro ao baixar PDF: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openInBrowser(PluginCall call) {
        String url = call.getString("url");

        if (url == null || url.isEmpty()) {
            call.reject("URL é obrigatória");
            return;
        }

        try {
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            getActivity().startActivity(browserIntent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Erro ao abrir navegador: " + e.getMessage());
        }
    }

    private void registerDownloadReceiver() {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);

                if (downloadId == currentDownloadId && downloadId != -1) {
                    Log.d(TAG, "Download concluído! ID: " + downloadId);

                    DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
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
                                // Abrir PDF
                                openPdfFile(localUri);

                                // Responder sucesso
                                if (savedCall != null) {
                                    JSObject result = new JSObject();
                                    result.put("success", true);
                                    result.put("path", localUri);
                                    savedCall.resolve(result);
                                    savedCall = null;
                                }
                            } else {
                                if (savedCall != null) {
                                    savedCall.reject("Erro no download");
                                    savedCall = null;
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Erro ao verificar download", e);
                    } finally {
                        if (cursor != null) {
                            cursor.close();
                        }
                    }

                    // Desregistrar receiver
                    try {
                        context.unregisterReceiver(this);
                    } catch (Exception e) {
                        // Ignorar
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
    }

    private void openPdfFile(String uriString) {
        try {
            Log.d(TAG, "Abrindo PDF: " + uriString);

            Uri fileUri = Uri.parse(uriString);
            String path = fileUri.getPath();

            if (path == null) {
                showToast("✅ PDF salvo em Downloads!");
                return;
            }

            File file = new File(path);
            Log.d(TAG, "Arquivo: " + file.getAbsolutePath() + ", existe: " + file.exists());

            // Criar URI com FileProvider
            Uri contentUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                contentUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
                );
            } else {
                contentUri = Uri.fromFile(file);
            }

            // Intent para abrir PDF - OBRIGATÓRIO: application/pdf
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/pdf");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (intent.resolveActivity(getContext().getPackageManager()) != null) {
                getContext().startActivity(intent);
                showToast("✅ PDF baixado!");
            } else {
                showToast("✅ PDF salvo em Downloads/" + file.getName());
            }

        } catch (Exception e) {
            Log.e(TAG, "Erro ao abrir PDF: " + e.getMessage(), e);
            showToast("✅ PDF salvo em Downloads!");
        }
    }

    private void showToast(String message) {
        getActivity().runOnUiThread(() -> {
            Toast.makeText(getContext(), message, Toast.LENGTH_LONG).show();
        });
    }
}
