const { withAndroidManifest } = require('@expo/config-plugins');

const BLOCKED_PERMISSIONS = new Set([
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW',
]);

/** Keep production Android manifests private-by-default after every Expo prebuild. */
module.exports = function withNetworkSecurity(config) {
    return withAndroidManifest(config, (nextConfig) => {
        const manifest = nextConfig.modResults.manifest;
        manifest['uses-permission'] = (manifest['uses-permission'] ?? []).filter(
            (permission) => !BLOCKED_PERMISSIONS.has(permission.$?.['android:name']),
        );
        const application = manifest.application?.[0];
        if (application) {
            application.$ = {
                ...application.$,
                'android:allowBackup': 'false',
                'android:usesCleartextTraffic': 'false',
            };
        }
        return nextConfig;
    });
};
