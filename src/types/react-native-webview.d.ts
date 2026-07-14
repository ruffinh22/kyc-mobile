declare module 'react-native-webview' {
  import * as React from 'react';
  import { ViewProps } from 'react-native';

  export interface WebViewProps extends ViewProps {
    source?: { uri?: string; html?: string } | number;
    startInLoadingState?: boolean;
    scalesPageToFit?: boolean;
    javaScriptEnabled?: boolean;
    domStorageEnabled?: boolean;
    geolocationEnabled?: boolean;
    allowsInlineMediaPlayback?: boolean;
    [key: string]: any;
  }

  const WebView: React.ComponentType<WebViewProps>;
  export default WebView;
  export { WebView };
}
