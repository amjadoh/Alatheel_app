import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.alatheel.stable",
  appName: "الأثيل",
  webDir: "dist",
  includePlugins: [
    "@capacitor/app",
    "@capacitor/filesystem",
    "@capacitor/share",
    "@capacitor-firebase/authentication",
  ],
  plugins: {
    FirebaseAuthentication: { skipNativeAuth: true, providers: ["google.com"] },
  },
  server: { errorPath: "webview-update.html" },
  android: { backgroundColor: "#171916", minWebViewVersion: 108 },
};
export default config;
