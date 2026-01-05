# React Native Track Player Fix for Expo Cloud Builds

This document explains the fixes applied to resolve Kotlin compilation errors in Expo cloud builds.

## Problem
The `react-native-track-player` v4.1.2 has Kotlin nullability compatibility issues with Expo's build environment, causing compilation errors:
- `Argument type mismatch: actual type is 'Bundle?', but 'Bundle' was expected`

## Solutions Applied

### 1. Version Downgrade (Primary Fix)
Downgraded from `^4.1.2` to `^4.0.1` which has better Kotlin compatibility.

### 2. Kotlin Version Configuration
Added `"kotlinVersion": "1.8.10"` to expo-build-properties in app.json.

### 3. Patch Package
Created a patch file `patches/react-native-track-player+4.0.1.patch` that fixes the nullability issues in:
- `getTrack()` method
- `getActiveTrack()` method  
- `getQueue()` method

### 4. Post-install Script
Added `patch-package` to postinstall script to automatically apply patches.

## Alternative Solutions

If the build still fails, you can try:

1. **Use react-native-track-player v3.2.0** (most stable with Expo):
   ```json
   "react-native-track-player": "3.2.0"
   ```

2. **Use a patched fork**:
   ```json
   "react-native-track-player": "github:doublesymmetry/react-native-track-player#expo-fix"
   ```

3. **Add additional Kotlin configuration** in `eas.json`:
   ```json
   "production-apk": {
     "android": {
       "buildType": "apk",
       "gradleCommand": ":app:assembleRelease",
       "image": "latest",
       "env": {
         "NODE_ENV": "production",
         "EXPO_ANDROID_ABI_FILTERS": "armeabi-v7a,arm64-v8a,x86,x86_64",
         "KOTLIN_VERSION": "1.8.10"
       }
     }
   }
   ```

## Testing
After committing these changes:
1. Push to GitHub
2. Trigger a new build via GitHub Actions
3. Check the build logs for any remaining Kotlin compilation errors

If issues persist, consider using v3.2.0 which is known to be more compatible with Expo builds.