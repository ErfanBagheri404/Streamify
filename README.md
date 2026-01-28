<img width="1632" height="656" alt="StreamifyBanner" src="https://github.com/user-attachments/assets/d5eedf8e-ff9f-4cfa-bd05-f780a91b216f" />

# Streamify 🎵

A modern, feature-rich music streaming application built with React Native and Expo, designed to deliver seamless audio experiences across Android devices.

## Features ✨

### 🎧 Music Streaming

- **Multi-source streaming**: YouTube, Spotify, and local audio files
- **Background playback**: Continue listening while using other apps
- **High-quality audio**: Support for various formats and bitrates
- **Offline mode**: Download tracks for offline listening

### 🎨 User Interface

- **Modern design**: Clean, intuitive interface with dark theme
- **Responsive layout**: Optimized for all screen sizes
- **Smooth animations**: Native-like transitions and interactions
- **Customizable themes**: Personalize your listening experience

### 📱 Core Functionality

- **Search & discovery**: Find music across multiple platforms
- **Playlists**: Create, manage, and share custom playlists
- **Queue management**: Dynamic playback queue with drag-and-drop
- **Player controls**: Full-featured media controls with progress tracking
- **Recently played**: Quick access to your listening history

### 🔧 Technical Features

- **Cross-platform**: Built with React Native for consistent experience
- **Expo integration**: Leverages Expo's powerful development tools
- **Native performance**: Optimized for smooth audio playback
- **TypeScript**: Fully typed for better development experience

## Tech Stack 🛠️

- **Frontend**: React Native, TypeScript, Styled Components
- **Backend Integration**: YouTube API, Spotify Web API
- **Audio Processing**: react-native-track-player, expo-av
- **State Management**: React Context, AsyncStorage
- **Development**: Expo CLI, Metro bundler
- **Build System**: EAS Build, GitHub Actions CI/CD

## Getting Started 🚀

### Prerequisites

- Node.js (v18.0.0 or higher)
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- Android Studio (for Android development)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/streamify.git
   cd streamify
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the development server**

   ```bash
   npm start
   ```

4. **Run on Android**
   ```bash
   npm run android
   ```

### Build for Production

1. **Configure EAS Build**

   ```bash
   eas build:configure
   ```

2. **Build production APK**
   ```bash
   npm run build:android
   ```

## Configuration ⚙️

### Environment Variables

Create a `.env` file in the root directory:

```env
# API Keys
YOUTUBE_API_KEY=your_youtube_api_key
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# App Configuration
APP_NAME=Streamify
APP_SCHEME=streamify
```

### Build Configuration

The app uses EAS Build for production builds. Configuration is available in:

- `eas.json` - Build profiles and settings
- `app.json` - Expo app configuration
- `.github/workflows/` - CI/CD pipeline

## Development 🛠️

### Available Scripts

- `npm start` - Start Expo development server
- `npm run android` - Run on Android device/emulator
- `npm run ios` - Run on iOS device/simulator
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run tsc` - Type checking

### Project Structure

```
streamify/
├── components/          # React Native components
├── screens/              # App screens
├── utils/                # Utility functions
├── assets/               # Images, fonts, etc.
├── patches/              # Package patches
├── .github/workflows/    # CI/CD configuration
└── docs/                 # Documentation
```

## Troubleshooting 🔧

### Common Issues

1. **Build fails with Kotlin errors**
   - Solution: Check `REACT_NATIVE_TRACK_PLAYER_FIX.md` for patch instructions

2. **Audio playback issues**
   - Ensure proper permissions are granted
   - Check audio service configuration in `app.json`

3. **API connection problems**
   - Verify API keys in environment variables
   - Check network connectivity

### Build Issues

For detailed build troubleshooting, see:

- `REACT_NATIVE_TRACK_PLAYER_FIX.md` - Kotlin compilation fixes
- Expo build logs in GitHub Actions
- EAS dashboard for build details

## Contributing 🤝

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Use ESLint and Prettier for code formatting
- Write meaningful commit messages
- Test on multiple devices when possible
- Update documentation for new features

## License 📄

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments 🙏

- React Native community for the excellent framework
- Expo team for development tools and services
- react-native-track-player contributors
- All open-source libraries that make this project possible

## Support 💬

- Create an issue for bug reports
- Check existing issues before reporting new ones
- Provide detailed information including:
  - Device/OS version
  - App version
  - Steps to reproduce
  - Error messages/screenshots

---

**Made with ❤️ for music lovers everywhere**
