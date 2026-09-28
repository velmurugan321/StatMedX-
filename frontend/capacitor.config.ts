import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.statmedx.app",
  appName: "StatMedX",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
