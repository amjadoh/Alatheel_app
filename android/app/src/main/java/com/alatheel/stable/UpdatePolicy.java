package com.alatheel.stable;

final class UpdatePolicy {
    static boolean valid(int code, String version, String packageId, String url, String sha, long size) {
        return code > 0 && version != null && version.matches("[0-9]+\\.[0-9]+\\.[0-9]+")
            && "com.alatheel.stable".equals(packageId)
            && ("https://alatheel-app-426403695200.web.app/downloads/Alatheel-" + version + ".apk").equals(url)
            && sha != null && sha.matches("[a-f0-9]{64}") && size > 0 && size <= 100L * 1024 * 1024;
    }
}
