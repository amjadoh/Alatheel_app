package com.alatheel.stable;

final class UpdatePolicy {
    static final int METADATA_CONNECT_TIMEOUT_MS = 3500;
    static final int METADATA_READ_TIMEOUT_MS = 3500;
    static final int METADATA_TOTAL_TIMEOUT_MS = 8000;
    static boolean channel(String value) {
        return "stable".equals(value) || "beta".equals(value);
    }
    static String manifestPath(String channel) {
        return "beta".equals(channel) ? "/beta/latest.json" : "/latest.json";
    }
    static String apkUrl(String channel, String version) {
        String lane = "beta".equals(channel) ? "beta/" : "";
        return "https://alatheel-app-426403695200.web.app/downloads/" + lane
            + "Alatheel-" + version + ".apk";
    }
    static boolean valid(String channel, String manifestChannel, int code, String version,
            String packageId, String url, String sha, long size) {
        String declared = manifestChannel == null || manifestChannel.isEmpty() ? "stable" : manifestChannel;
        return code > 0 && version != null && version.matches("[0-9]+\\.[0-9]+\\.[0-9]+")
            && channel(channel) && channel.equals(declared)
            && "com.alatheel.stable".equals(packageId)
            && apkUrl(channel, version).equals(url)
            && sha != null && sha.matches("[a-f0-9]{64}") && size > 0 && size <= 100L * 1024 * 1024;
    }
}
