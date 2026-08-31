import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withDangerousMod, withEntitlementsPlist, withXcodeProject, type ConfigPlugin } from '@expo/config-plugins';

const GROUP = 'group.com.padhaikaro.app';
const TARGET = 'PadhaiKaroWidget';
const WIDGET_FILES = ['PadhaiKaroWidget.swift', 'PadhaiKaroWidget.entitlements'];
const BRIDGE_FILES = ['PadhaiKaroWidgetBridge.swift', 'PadhaiKaroWidgetBridge.m'];

const widgetInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>CFBundleDisplayName</key><string>PadhaiKaro Widget</string>
    <key>CFBundlePackageType</key><string>XPC!</string>
    <key>NSExtension</key><dict>
        <key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string>
        <key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).PadhaiKaroWidget</string>
    </dict>
</dict></plist>`;

/**
 * Adds the WidgetKit extension during an iOS prebuild. The plugin is intentionally
 * idempotent so running `expo prebuild` repeatedly does not duplicate targets/files.
 * Apple Developer provisioning and signing remain an Xcode/macOS responsibility.
 */
const withPadhaiKaroWidget: ConfigPlugin = (config) => {
    config = withEntitlementsPlist(config, (mod) => {
        const groups = mod.modResults['com.apple.security.application-groups'];
        const existing = Array.isArray(groups) ? groups.filter((value): value is string => typeof value === 'string') : [];
        mod.modResults['com.apple.security.application-groups'] = Array.from(new Set([...existing, GROUP]));
        return mod;
    });

    config = withDangerousMod(config, ['ios', async (mod) => {
        const sourceDir = path.join(mod.modRequest.projectRoot, 'ios-widget');
        const targetDir = path.join(mod.modRequest.platformProjectRoot, TARGET);
        await mkdir(targetDir, { recursive: true });
        for (const file of WIDGET_FILES) await copyFile(path.join(sourceDir, file), path.join(targetDir, file));
        await writeFile(path.join(targetDir, `${TARGET}-Info.plist`), widgetInfoPlist, 'utf8');
        for (const file of BRIDGE_FILES) await copyFile(path.join(sourceDir, file), path.join(targetDir, file));
        return mod;
    }]);

    return withXcodeProject(config, (mod) => {
        const project = mod.modResults;
        const appTarget = project.getFirstTarget();
        const existingWidget = project.pbxTargetByName(TARGET);
        const widgetTarget = existingWidget
            ? { uuid: project.findTargetKey(TARGET) as string }
            : project.addTarget(TARGET, 'app_extension', TARGET, 'com.padhaikaro.app.widget');

        const addSource = (file: string, target: { uuid: string }): void => {
            const relative = `${TARGET}/${file}`;
            if (!project.hasFile(relative)) project.addSourceFile(relative, { target: target.uuid });
        };
        addSource('PadhaiKaroWidget.swift', widgetTarget);
        addSource('PadhaiKaroWidgetBridge.swift', appTarget);
        addSource('PadhaiKaroWidgetBridge.m', appTarget);
        if (!project.hasFile('WidgetKit.framework')) {
            const framework = project.addFramework('WidgetKit.framework', { target: appTarget.uuid });
            if (framework) {
                framework.target = widgetTarget.uuid;
                project.addToPbxFrameworksBuildPhase(framework);
            }
        }

        project.updateBuildProperty('CODE_SIGN_ENTITLEMENTS', `${TARGET}/PadhaiKaroWidget.entitlements`, undefined, TARGET);
        project.updateBuildProperty('SWIFT_VERSION', '5.0', undefined, TARGET);
        project.updateBuildProperty('IPHONEOS_DEPLOYMENT_TARGET', '16.0', undefined, TARGET);
        project.updateBuildProperty('TARGETED_DEVICE_FAMILY', '1,2', undefined, TARGET);
        project.updateBuildProperty('APPLICATION_EXTENSION_API_ONLY', 'YES', undefined, TARGET);
        if (mod.ios?.appleTeamId) project.updateBuildProperty('DEVELOPMENT_TEAM', mod.ios.appleTeamId, undefined, TARGET);
        return mod;
    });
};

export default withPadhaiKaroWidget;
