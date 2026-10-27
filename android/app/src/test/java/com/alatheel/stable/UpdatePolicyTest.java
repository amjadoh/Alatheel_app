package com.alatheel.stable;

import static org.junit.Assert.*;
import org.junit.Test;

public class UpdatePolicyTest {
    @Test public void metadataHasShortPerStageAndTotalDeadlines() {
        assertTrue(UpdatePolicy.METADATA_CONNECT_TIMEOUT_MS > 0);
        assertTrue(UpdatePolicy.METADATA_READ_TIMEOUT_MS > 0);
        assertTrue(UpdatePolicy.METADATA_TOTAL_TIMEOUT_MS <= 8000);
        assertTrue(UpdatePolicy.METADATA_TOTAL_TIMEOUT_MS >=
            UpdatePolicy.METADATA_CONNECT_TIMEOUT_MS + UpdatePolicy.METADATA_READ_TIMEOUT_MS);
    }
    private static final String URL = "https://alatheel-app-426403695200.web.app/downloads/Alatheel-1.4.0.apk";
    private static final String BETA_URL = "https://alatheel-app-426403695200.web.app/downloads/beta/Alatheel-1.4.0.apk";
    private static final String SHA = "a".repeat(64);
    private boolean valid(String url, String sha, long size) {
        return UpdatePolicy.valid("stable", "stable", 5, "1.4.0", "com.alatheel.stable", url, sha, size);
    }
    @Test public void acceptsPublishedRelease() { assertTrue(valid(URL, SHA, 7000000)); }
    @Test public void supportsStableAndBetaManifestLanes() {
        assertEquals("/latest.json", UpdatePolicy.manifestPath("stable"));
        assertEquals("/beta/latest.json", UpdatePolicy.manifestPath("beta"));
        assertTrue(UpdatePolicy.valid("beta", "beta", 5, "1.4.0", "com.alatheel.stable", BETA_URL, SHA, 7000000));
        assertFalse(UpdatePolicy.valid("stable", "beta", 5, "1.4.0", "com.alatheel.stable", BETA_URL, SHA, 7000000));
        assertFalse(UpdatePolicy.channel("preview"));
    }
    @Test public void missingManifestChannelIsBackwardCompatibleOnlyForStable() {
        assertTrue(UpdatePolicy.valid("stable", "", 5, "1.4.0", "com.alatheel.stable", URL, SHA, 7000000));
        assertFalse(UpdatePolicy.valid("beta", "", 5, "1.4.0", "com.alatheel.stable", BETA_URL, SHA, 7000000));
    }
    @Test public void rejectsOtherHostsAndHttp() {
        assertFalse(valid(URL.replace("https:", "http:"), SHA, 7000000));
        assertFalse(valid(URL.replace(".web.app", ".web.app.evil.test"), SHA, 7000000));
        assertFalse(valid(URL + "?redirect=evil", SHA, 7000000));
    }
    @Test public void requiresVersionedApkAndMatchingPackage() {
        assertFalse(valid(URL.replace("1.4.0", "latest"), SHA, 7000000));
        assertFalse(UpdatePolicy.valid("stable", "stable", 5, "1.4.0", "other.package", URL, SHA, 7000000));
        assertFalse(UpdatePolicy.valid("stable", "stable", 5, "1.4.1", "com.alatheel.stable", URL, SHA, 7000000));
    }
    @Test public void rejectsIncompleteOrHugeMetadata() {
        assertFalse(valid(URL, "not-a-checksum", 7000000));
        assertFalse(valid(URL, SHA, 0));
        assertFalse(valid(URL, SHA, 100L * 1024 * 1024 + 1));
        assertFalse(UpdatePolicy.valid("stable", "stable", 0, "1.4.0", "com.alatheel.stable", URL, SHA, 7000000));
    }
}
