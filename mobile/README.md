# Family Expenses Mobile

Native iOS and Android client built with Expo. It supports family accounts, child profiles, timestamped home-lesson entries, monthly tutoring totals, recurring tuition, household expenses, and monthly household totals.

## Run

```sh
npm install
npm start
```

Scan the terminal QR code with Expo Go, or press `i` for an installed iOS Simulator / `a` for an Android emulator. You can also run `npm run ios` or `npm run android`.

The app starts in Arabic. Sign in with your family account or create one from the app. Refresh tokens are stored in iOS Keychain or Android Keystore.

## API address

The app uses `EXPO_PUBLIC_API_URL`. The Android emulator can use `http://10.0.2.2:5001/api`; iOS Simulator can use `http://localhost:5001/api`. A physical iPhone needs your Mac's LAN address, for example:

```sh
EXPO_PUBLIC_API_URL=http://192.168.1.10:5001/api
```

Keep the API server running and connect the phone and Mac to the same Wi-Fi network. The current development LAN URL is kept in the ignored `.env.local`; update it when your Mac's address changes.

## Siri

After installing a native iOS build and signing in once, say “Add a home lesson with Family Expenses.” Siri asks for the child's name and lesson amount; the intent records the current date and time. The iPhone must be unlocked before the financial write is sent. The spoken child name must match one child in the signed-in family.

Expo Go cannot run custom App Intents. Use a rebuilt iOS development or preview app after changing native code. Build locally with Xcode or use EAS Build with `EXPO_PUBLIC_API_URL` set to a public HTTPS API URL. The local LAN URL only works while the iPhone and development server are on the same network.

## Monthly totals

The dashboard separates home-lesson session spending from scheduled monthly tuition, and household spending from pending recurring household charges. Per-child lesson totals include both sessions and scheduled tuition. Expense amounts are stored and summed as decimal values on the server.