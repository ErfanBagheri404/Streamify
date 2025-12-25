#!/bin/bash

echo "=== Build Configuration Verification ==="
echo

# Check Android SDK versions
echo "Android SDK Configuration:"
echo "- Compile SDK: $(grep -o 'android.compileSdkVersion=[0-9]*' android/gradle.properties | cut -d= -f2)"
echo "- Target SDK: $(grep -o 'android.targetSdkVersion=[0-9]*' android/gradle.properties | cut -d= -f2)"
echo "- Min SDK: $(grep -o 'android.minSdkVersion=[0-9]*' android/gradle.properties | cut -d= -f2)"
echo

# Check build configuration
echo "Build Configuration:"
echo "- Gradle Version: $(grep -o 'gradle-[0-9.]*' android/gradle/wrapper/gradle-wrapper.properties | head -1)"
echo "- Build Tools: $(grep -o 'buildToolsVersion.*' android/app/build.gradle | head -1)"
echo

# Check signing configuration
echo "Signing Configuration:"
if grep -q "signingConfig signingConfigs.debug" android/app/build.gradle; then
    echo "- Using debug signing (OK for testing)"
else
    echo "- WARNING: Signing configuration unclear"
fi
echo

# Check architecture support
echo "Architecture Support:"
echo "- Supported ABIs: $(grep -o 'reactNativeArchitectures=.*' android/gradle.properties | cut -d= -f2)"
echo

# Check APK validation tools
echo "APK Validation Tools:"
if command -v unzip >/dev/null 2>&1; then
    echo "- unzip: Available"
else
    echo "- unzip: Not available"
fi

if command -v aapt >/dev/null 2>&1; then
    echo "- aapt: Available"
else
    echo "- aapt: Not available (install Android SDK build-tools)"
fi
echo

echo "=== Verification Complete ==="