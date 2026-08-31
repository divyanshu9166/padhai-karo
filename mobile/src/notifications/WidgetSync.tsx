import React, { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

import { getWidgetSummary } from '@/api/upscProduct';
import { useAuth } from '@/state';

export function WidgetSync(): React.JSX.Element | null {
    const { status } = useAuth();
    useEffect(() => {
        if (status !== 'authenticated') return;
        void getWidgetSummary().then(({ widget }) => {
            void AsyncStorage.setItem('widget:summary', JSON.stringify(widget));
            if (Platform.OS === 'android') NativeModules.PadhaiKaroWidget?.updateSummary(widget.todayMinutes, widget.pendingTopics);
            if (Platform.OS === 'ios') NativeModules.PadhaiKaroWidgetBridge?.update(widget.todayMinutes, widget.pendingTopics);
        }).catch(() => undefined);
    }, [status]);
    return null;
}
