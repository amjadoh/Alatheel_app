package com.alatheel.stable;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Sideloaded Android updates. Only our HTTPS host, package and release signer are accepted. */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String HOST = "https://alatheel-app-426403695200.web.app";
    private static final String CERT = "2f508f35d389af0260d7d216fb750e2e49ecaeb4e4ffe5a9f928b1f7a7d6f83f";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private volatile JSONObject release;

    private File apk() { return new File(getContext().getCacheDir(), "alatheel-update.apk"); }
    private File metadata() { return new File(getContext().getCacheDir(), "alatheel-update.json"); }
    private HttpURLConnection open(String address) throws Exception {
        URL url = new URL(address);
        if (!url.getProtocol().equals("https") || !url.getHost().equals("alatheel-app-426403695200.web.app")
                || url.getPort() != -1 || url.getUserInfo() != null) throw new IOException("Invalid update host");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        if (c.getResponseCode() != 200) { c.disconnect(); throw new IOException("Update unavailable"); }
        return c;
    }
    private long code(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }
    private long installed() throws Exception {
        return code(getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0));
    }
    private JSONObject valid(JSONObject m) throws Exception {
        int version = m.getInt("versionCode");
        String name = m.getString("versionName");
        if (!UpdatePolicy.valid(version, name, m.getString("packageId"), m.getString("url"),
                m.getString("sha256"), m.getLong("size"))) throw new IOException("Invalid update metadata");
        return m;
    }
    private String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b & 255));
        return out.toString();
    }
    private void verify(File file, JSONObject m) throws Exception {
        if (file.length() != m.getLong("size")) throw new IOException("Incomplete update");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        if (!hex(digest.digest()).equals(m.getString("sha256"))) throw new IOException("Invalid update checksum");
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (archive == null || !archive.packageName.equals(getContext().getPackageName())
                || code(archive) != m.getInt("versionCode") || code(archive) <= installed()
                || !m.getString("versionName").equals(archive.versionName)) throw new IOException("Wrong update package");
        Signature[] signers = Build.VERSION.SDK_INT >= 28
                ? (archive.signingInfo == null ? null : archive.signingInfo.getApkContentsSigners()) : archive.signatures;
        if (signers == null || signers.length != 1
                || !hex(MessageDigest.getInstance("SHA-256").digest(signers[0].toByteArray())).equals(CERT))
            throw new IOException("Wrong update signer");
    }
    private boolean ready(JSONObject m) {
        try { verify(apk(), m); return true; } catch (Exception ignored) { return false; }
    }

    @PluginMethod
    public void check(PluginCall call) {
        worker.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = open(HOST + "/latest.json");
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] bytes = new byte[4096]; int n;
                    while ((n = in.read(bytes)) != -1) {
                        buffer.write(bytes, 0, n);
                        if (buffer.size() > 16384) throw new IOException("Metadata too large");
                    }
                }
                JSONObject next = valid(new JSONObject(buffer.toString("UTF-8")));
                release = next;
                JSObject result = new JSObject();
                result.put("available", next.getInt("versionCode") > installed());
                result.put("versionName", next.getString("versionName"));
                result.put("notes", next.optString("notes", "تحسينات وإصلاحات للتطبيق"));
                result.put("ready", next.getInt("versionCode") > installed() && ready(next));
                call.resolve(result);
            } catch (Exception e) {
                android.util.Log.w("AlatheelUpdater", "Public update metadata check failed", e);
                call.reject("تعذر التحقق من التحديث. تحقق من الإنترنت وأعد المحاولة.");
            }
            finally { if (c != null) c.disconnect(); }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (!downloading.compareAndSet(false, true)) { call.reject("التنزيل قيد التنفيذ"); return; }
        final JSONObject target = release;
        worker.execute(() -> {
            HttpURLConnection c = null;
            File partial = new File(getContext().getCacheDir(), "alatheel-update.part");
            try {
                if (target == null || target.getInt("versionCode") <= installed()) throw new IOException("Check first");
                if (!ready(target)) {
                    c = open(target.getString("url"));
                    long size = target.getLong("size"), count = 0; int last = -1;
                    try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
                        byte[] buffer = new byte[65536]; int n;
                        while ((n = in.read(buffer)) != -1) {
                            count += n;
                            if (count > size) throw new IOException("Update too large");
                            out.write(buffer, 0, n);
                            int percent = (int) (count * 100 / size);
                            if (last != percent) {
                                last = percent; JSObject progress = new JSObject(); progress.put("percent", percent);
                                notifyListeners("progress", progress);
                            }
                        }
                    }
                    verify(partial, target);
                    if (apk().exists() && !apk().delete()) throw new IOException("Cache busy");
                    if (!partial.renameTo(apk())) throw new IOException("Cache unavailable");
                    try (OutputStream out = new FileOutputStream(metadata())) {
                        out.write(target.toString().getBytes(StandardCharsets.UTF_8));
                    }
                }
                call.resolve();
            } catch (Exception e) { call.reject("تعذر تنزيل التحديث أو التحقق منه. أعد المحاولة."); }
            finally { partial.delete(); downloading.set(false); if (c != null) c.disconnect(); }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        worker.execute(() -> {
            try {
                JSONObject target = release;
                if (target == null && metadata().length() <= 16384) {
                    try (InputStream in = new FileInputStream(metadata())) {
                        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                        byte[] b = new byte[4096]; int n;
                        while ((n = in.read(b)) != -1) bytes.write(b, 0, n);
                        target = valid(new JSONObject(bytes.toString("UTF-8")));
                    }
                }
                if (target == null) throw new IOException("Download first");
                verify(apk(), target);
                getActivity().runOnUiThread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getContext().getPackageName())));
                            JSObject result = new JSObject(); result.put("permissionRequired", true); call.resolve(result);
                            return;
                        }
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk());
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(uri, "application/vnd.android.package-archive");
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(intent);
                        JSObject result = new JSObject(); result.put("permissionRequired", false); call.resolve(result);
                    } catch (Exception e) { call.reject("تعذر فتح شاشة التثبيت. أعد المحاولة."); }
                });
            } catch (Exception e) { call.reject("ملف التحديث غير جاهز. أعد التحقق وتنزيل التحديث."); }
        });
    }
}

