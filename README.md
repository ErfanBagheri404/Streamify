<p align="center">
  <img src="https://raw.githubusercontent.com/ErfanBagheri404/streamifyweb-player/master/client/public/Banner.png" alt="Streamify banner" width="100%" />
</p>

<h1 align="center">Streamify</h1>

<p align="center">
  A modern multi-source music streaming app built with React Native and Expo for Android — search, play, queue, and manage your library across YouTube, YouTube Music, SoundCloud, and JioSaavn.
</p>

<p align="center">
  <a href="#english">English</a> |
  <a href="#فارسی">فارسی</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React_Native-0.81-61DAFB?style=for-the-badge&logo=react" alt="React Native 0.81" />
  <img src="https://img.shields.io/badge/Expo-54-000020?style=for-the-badge&logo=expo" alt="Expo 54" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react" alt="React 19" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Playback-Multi--source-6C47FF?style=flat-square" alt="Multi-source playback" />
  <img src="https://img.shields.io/badge/Background-Built--in-2563EB?style=flat-square" alt="Background playback" />
  <img src="https://img.shields.io/badge/Locales-English%20%7C%20Persian-0F766E?style=flat-square" alt="Bilingual UI" />
  <img src="https://img.shields.io/badge/Audio-HLS%20%7C%20Track%20Player%20%7C%20Video%20Cache-0EA5E9?style=flat-square" alt="Audio stack" />
</p>

<div align="center">

[![Downloads](https://img.shields.io/github/downloads/ErfanBagheri404/Streamify/total?style=flat-square&logo=github)](https://github.com/ErfanBagheri404/Streamify/releases/)
[![Last Version](https://img.shields.io/github/release/ErfanBagheri404/Streamify/all.svg?style=flat-square)](https://github.com/ErfanBagheri404/Streamify/releases/)

</div>

## 📥 Direct Download

<table align="center">
    <thead>
        <tr>
            <th>Platform</th>
            <th>Download</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>Android</td>
            <td>
                <a href="https://github.com/ErfanBagheri404/Streamify/releases/latest/download/Streamify-v2.00.00.apk"><img src="https://img.shields.io/badge/APK-Universal-044d29.svg?logo=android"></a>
            </td>
        </tr>
    </tbody>
</table>

---

## English

### Overview

Streamify is a feature-rich music streaming app for Android built with React Native and Expo. It brings together multi-source search, rich playback controls, background playback, queue management, and a full local library — liked songs, playlists, recently played, and cloud sync — in one modern, dark-themed interface with English and Persian localization.

### Why It Stands Out

| Area | What you get |
| --- | --- |
| Discovery | Unified search across YouTube, YouTube Music, SoundCloud, and JioSaavn |
| Playback | Queue management, repeat and seek, volume, HLS livestream support, and background playback via `react-native-track-player` |
| Library | Liked songs, custom playlists, recently played tracks, and local persistence |
| Cloud | Supabase-backed accounts with cloud library sync across devices |
| UX | Dark theme, onboarding flow, drag-and-drop queue, offline caching, and in-app update checks |
| Languages | English and Persian (فارسی) localization built in |

### Tech Stack

- **Framework**: `React Native 0.81`, `React 19`, `Expo SDK 54`, `TypeScript 5`
- **Playback**: `react-native-track-player`, `expo-av`, `hls.js`, `react-native-video-cache`
- **State and persistence**: `zustand`, `AsyncStorage`, `app-settings` and `runtime-config` modules
- **Cloud**: `@supabase/supabase-js` for auth and cloud library sync
- **UI**: `styled-components`, `react-navigation`, `react-native-reanimated`, `@expo/vector-icons`
- **Build**: EAS Build profiles, GitHub Actions CI/CD (`react-native-cicd.yml`)

### Architecture Snapshot

```text
.
|-- components/        Screens and UI components (player, library, settings, onboarding)
|-- lib/               Business logic: runtime config, provider endpoints, cloud sync, backend API
|-- locales/           English and Persian translation files
|-- assets/            Images, icons, fonts, and category artwork
|-- patches/           patch-package patches (react-native-track-player fixes)
|-- .github/workflows/ EAS builds and release automation
|-- dist/              Expo export output
```

### Main Product Areas

- `components/screens/PlayerScreen.tsx`: full playback surface — queue, repeat, seek, lyrics, HLS livestreams
- `components/screens/SearchScreen.tsx`: multi-source search across YouTube, YouTube Music, SoundCloud, and JioSaavn
- `components/screens/LibraryScreen.tsx`, `LikedSongsScreen.tsx`, `ListsScreen.tsx`: liked songs, playlists, and library management
- `components/screens/HomeScreen.tsx` and `HomeFeedScreen.tsx`: recommendations and feed surfaces
- `components/screens/SettingsScreen.tsx`: app settings, themes, and in-app update checks
- `lib/cloud-library-sync.ts`: Supabase-backed library sync across devices
- `lib/runtime-config.ts`: provider instances, API bases, and runtime configuration

### Quick Start

#### Prerequisites

- `Node.js 18+` (20 recommended)
- `npm`
- `Android Studio` (for emulator/device development)
- `expo-cli` or the `eas-cli` for production builds

#### Install Dependencies

```bash
npm install
```

#### Start Development

```bash
npm start
```

Then press `a` for Android, or run:

```bash
npm run android
```

#### Build for Production

```bash
npx eas build --platform android --profile production
```

or use the provided script:

```bash
npm run build:android
```

### Scripts

| Scope | Command | Description |
| --- | --- | --- |
| Dev | `npm start` | Start the Expo development server |
| Dev | `npm run android` | Run on Android device/emulator |
| Dev | `npm run ios` | Run on iOS simulator |
| Dev | `npm run web` | Run the web export of the app |
| Quality | `npm run typecheck` | Run TypeScript type checking |
| Quality | `npm run lint` | Run ESLint |
| Quality | `npm run format` | Format code with Prettier |
| Quality | `npm run format:check` | Verify formatting with Prettier |
| Build | `npm run build:android` | Build a production APK via EAS |
| Build | `npm run build:ios` | Build a production iOS app via EAS |
| Build | `npm run prebuild` | Generate native projects with `expo prebuild` |

### Configuration

Runtime configuration (provider instances, API bases, Supabase URL) lives in `lib/runtime-config.ts`. Environment-specific values can be supplied through `.env` via `react-native-dotenv`. EAS build profiles live in `eas.json` and app-level config in `app.json` (package `com.erfanbagheri.streamifymobile`).

### Troubleshooting

- **Kotlin build failures**: see `REACT_NATIVE_TRACK_PLAYER_FIX.md` for the required patch instructions
- **Playback issues**: check the foreground-service and notification config in `app.json`
- **Provider/API problems**: verify provider endpoints and API bases in `lib/runtime-config.ts` and `lib/provider-endpoints.ts`

### Contributing

- Issues, pull requests, and documentation updates are welcome in English and Persian
- Conventional Commits in English are preferred for consistency
- Recommended prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `chore:`, `test:`

### Support

- Create an issue for bug reports
- Check existing issues before reporting new ones
- Provide detailed information: device/OS version, app version, steps to reproduce, and error messages

---

## فارسی

### معرفی

استریمیفای یک اپلیکیشن پخش موسیقی مدرن برای اندروید است که با React Native و Expo ساخته شده. جستجوی چندمنبعه، پخش پیشرفته، پخش در پس‌زمینه، مدیریت صف، و کتابخانه کامل محلی — آهنگ‌های پسندیده، پلی‌لیست‌ها، تاریخچه پخش، و همگام‌سازی ابری — را در یک رابط تیره و مدرن با بومی‌سازی انگلیسی و فارسی کنار هم قرار می‌دهد.

### چرا این پروژه خاص است

| بخش | توضیح |
| --- | --- |
| جستجو | جستجوی یکپارچه بین YouTube و YouTube Music و SoundCloud و JioSaavn |
| پخش | مدیریت صف، تکرار، جابجایی زمانی، کنترل صدا، پشتیبانی از پخش زنده HLS، و پخش در پس‌زمینه با `react-native-track-player` |
| کتابخانه | آهنگ‌های پسندیده، پلی‌لیست‌های سفارشی، تاریخچه پخش، و نگه‌داری محلی داده‌ها |
| ابر | حساب‌های مبتنی بر Supabase با همگام‌سازی کتابخانه ابری بین دستگاه‌ها |
| تجربه کاربری | تم تیره، جریان خوش‌آمدگویی، صف با کشیدن و رها کردن، کش آفلاین، و بررسی به‌روزرسانی داخل برنامه |
| زبان‌ها | بومی‌سازی انگلیسی و فارسی داخلی |

### تکنولوژی‌ها

- **فریم‌ورک**: `React Native 0.81` و `React 19` و `Expo SDK 54` و `TypeScript 5`
- **پخش**: `react-native-track-player` و `expo-av` و `hls.js` و `react-native-video-cache`
- **وضعیت و ذخیره‌سازی**: `zustand` و `AsyncStorage` و ماژول‌های `app-settings` و `runtime-config`
- **ابر**: `@supabase/supabase-js` برای احراز هویت و همگام‌سازی کتابخانه ابری
- **رابط کاربری**: `styled-components` و `react-navigation` و `react-native-reanimated` و `@expo/vector-icons`
- **بیلد**: پروفایل‌های EAS Build و CI/CD با GitHub Actions

### نمای معماری

```text
.
|-- components/        اسکرین‌ها و کامپوننت‌های رابط (پلیر، کتابخانه، تنظیمات، خوش‌آمدگویی)
|-- lib/               منطق برنامه: تنظیمات اجرا، اندپوینت‌های منابع، همگام‌سازی ابری، API بک‌اند
|-- locales/           فایل‌های ترجمه انگلیسی و فارسی
|-- assets/            تصاویر، آیکون‌ها، فونت‌ها، و آرت‌ورک دسته‌ها
|-- patches/           پچ‌های patch-package (اصلاحات react-native-track-player)
|-- .github/workflows/ بیلدهای EAS و اتوماسیون انتشار
```

### بخش‌های اصلی برنامه

- `components/screens/PlayerScreen.tsx`: سطح کامل پخش — صف، تکرار، جابجایی زمانی، متن آهنگ، پخش زنده HLS
- `components/screens/SearchScreen.tsx`: جستجوی چندمنبعه در YouTube و YouTube Music و SoundCloud و JioSaavn
- `components/screens/LibraryScreen.tsx` و `LikedSongsScreen.tsx` و `ListsScreen.tsx`: آهنگ‌های پسندیده، پلی‌لیست‌ها، و مدیریت کتابخانه
- `components/screens/HomeScreen.tsx` و `HomeFeedScreen.tsx`: پیشنهادها و سطح فید
- `components/screens/SettingsScreen.tsx`: تنظیمات برنامه، تم‌ها، و بررسی به‌روزرسانی داخل برنامه
- `lib/cloud-library-sync.ts`: همگام‌سازی کتابخانه ابری با Supabase
- `lib/runtime-config.ts`: نمونه‌های منابع، آدرس‌های API، و تنظیمات اجرا

### شروع سریع

#### پیش‌نیازها

- `Node.js 18+` (نسخه ۲۰ پیشنهاد می‌شود)
- `npm`
- `Android Studio` (برای شبیه‌ساز یا دستگاه واقعی)
- `expo-cli` یا `eas-cli` برای بیلدهای پروداکشن

#### نصب وابستگی‌ها

```bash
npm install
```

#### اجرای محیط توسعه

```bash
npm start
```

سپس کلید `a` را برای اندروید فشار دهید، یا:

```bash
npm run android
```

#### بیلد پروداکشن

```bash
npx eas build --platform android --profile production
```

یا با اسکریپت موجود:

```bash
npm run build:android
```

### اسکریپت‌ها

| محدوده | دستور | توضیح |
| --- | --- | --- |
| توسعه | `npm start` | اجرای سرور توسعه Expo |
| توسعه | `npm run android` | اجرا روی دستگاه/شبیه‌ساز اندروید |
| توسعه | `npm run ios` | اجرا روی شبیه‌ساز iOS |
| توسعه | `npm run web` | اجرای خروجی وب برنامه |
| کیفیت | `npm run typecheck` | بررسی تایپ TypeScript |
| کیفیت | `npm run lint` | اجرای ESLint |
| کیفیت | `npm run format` | فرمت کد با Prettier |
| کیفیت | `npm run format:check` | بررسی فرمت با Prettier |
| بیلد | `npm run build:android` | بیلد APK پروداکشن با EAS |
| بیلد | `npm run build:ios` | بیلد iOS پروداکشن با EAS |
| بیلد | `npm run prebuild` | ساخت پروژه‌های نیتیو با `expo prebuild` |

### عیب‌یابی

- **خطای بیلد Kotlin**: فایل `REACT_NATIVE_TRACK_PLAYER_FIX.md` را برای دستورالعمل پچ ببینید
- **مشکل پخش**: تنظیمات foreground-service و ناتیفیکیشن را در `app.json` بررسی کنید
- **مشکل منابع/API**: اندپوینت‌های منابع را در `lib/runtime-config.ts` و `lib/provider-endpoints.ts` بررسی کنید

### مشارکت

- گزارش مشکل، پول‌ریکوئست، و به‌روزرسانی مستندات به انگلیسی و فارسی خوش‌آمد است
- Conventional Commits به انگلیسی برای یکدستی ترجیح داده می‌شود
- پیشوندهای پیشنهادی: `feat:` و `fix:` و `docs:` و `refactor:` و `perf:` و `chore:` و `test:`

---

**Made for music lovers everywhere 🎵**