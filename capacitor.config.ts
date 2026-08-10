import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.anchorapp.app',
  appName: 'Anchor',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      // Held open until src/main.tsx explicitly calls SplashScreen.hide()
      // once React has mounted, instead of racing a fixed duration against
      // the app's own load time.
      launchAutoHide: false,
      backgroundColor: '#F9F7F2',
    },
  },
};

export default config;
