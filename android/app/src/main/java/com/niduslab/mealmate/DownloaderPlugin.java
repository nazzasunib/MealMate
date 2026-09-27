package com.niduslab.mealmate;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Saves files made by the website (PDFs, backups, attachments) into the phone's
 * Downloads/MealMate folder and opens them.
 *
 * Why: the app shows the live website in an Android WebView, and a WebView
 * ignores browser-style downloads (blob: / data: links with "download"), so the
 * Download buttons did nothing. The website sends the file here as base64 via
 * window.Capacitor.Plugins.Downloader.save({ filename, data, mimeType }).
 *
 * Android 10+ uses MediaStore (no permission needed); Android 7–9 writes to the
 * public Download folder after asking for the storage permission.
 */
@CapacitorPlugin(
    name = "Downloader",
    permissions = { @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class DownloaderPlugin extends Plugin {

    private static final String FOLDER = "MealMate";

    @PluginMethod
    public void save(PluginCall call) {
        if (call.getString("filename") == null || call.getString("data") == null) {
            call.reject("filename and data are required");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }
        writeFile(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            writeFile(call);
        } else {
            call.reject("Storage permission is needed to save the file.", "PERMISSION_DENIED");
        }
    }

    private void writeFile(PluginCall call) {
        String name = safeName(call.getString("filename"));
        String mime = call.getString("mimeType", "application/octet-stream");
        try {
            byte[] bytes = Base64.decode(call.getString("data"), Base64.DEFAULT);
            Context context = getContext();
            Uri uri;
            String savedName = name;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = context.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("Could not create the file in Downloads");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IOException("Could not open the file for writing");
                    out.write(bytes);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, done, null, null);
                // Android renames duplicates ("file (1).pdf") — report the real name
                try (Cursor c = resolver.query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
                    if (c != null && c.moveToFirst()) savedName = c.getString(0);
                }
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER);
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Could not create the Downloads folder");
                File file = uniqueFile(dir, name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                MediaScannerConnection.scanFile(context, new String[] { file.getAbsolutePath() }, new String[] { mime }, null);
                savedName = file.getName();
                uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            }
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("name", savedName);
            ret.put("folder", "Download/" + FOLDER);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save the file: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("uri is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(uri), call.getString("mimeType", "*/*"));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app on this phone can open this file.", "NO_APP");
        }
    }

    private static String safeName(String name) {
        String s = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return s.isEmpty() ? "download" : s;
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; ; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
    }
}
