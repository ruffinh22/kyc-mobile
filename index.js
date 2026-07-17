import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './package.json';
import { notificationService } from './src/services/NotificationService';

notificationService.registerBackgroundHandlers().catch((err) => {
  console.warn('[Index] Background notification setup failed', err);
});

AppRegistry.registerComponent(appName, () => App);
