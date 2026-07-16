import KeepAwake from 'react-native-keep-awake';

export const keepAwake = {
  activate: () => {
    try {
      if (typeof KeepAwake?.activate === 'function') {
        KeepAwake.activate();
      }
    } catch (error) {
      console.warn('[KeepAwake] activate failed', error);
    }
  },
  deactivate: () => {
    try {
      if (typeof KeepAwake?.deactivate === 'function') {
        KeepAwake.deactivate();
      }
    } catch (error) {
      console.warn('[KeepAwake] deactivate failed', error);
    }
  },
};
