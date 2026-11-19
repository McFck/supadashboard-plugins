Adds synced lyrics, Spotify as a media widget source, and buttons to like songs, shuffle and repeat. Lyrics come from [LRCLIB](https://lrclib.net), a free lyrics library.

Connecting needs a free Spotify developer app of your own. Playback control needs Spotify Premium.

## 1. Create a Spotify app

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and sign in with your Spotify account. Accept the developer terms if asked.
2. Click **Create app**. Enter a name such as `SupaDashboard` and any short description.
3. Under **Redirect URIs**, enter `http://127.0.0.1:43821/callback` and click **Add**.
4. Under **Which API/SDKs are you planning to use?**, tick **Web API**.
5. Accept the terms and click **Save**.
6. Open the app's **Settings** and copy the **Client ID**.

## 2. Connect

1. Paste the Client ID into **Client ID** in the Connection section of this page.
2. Click **Connect**. Your browser opens Spotify: click **Agree**.
3. Status changes to **Connected as** your name.

## 3. Use it

- In **Layout**, add the **Lyrics** widget. Double-tap the lyrics to shift their timing when they run early or late.
- Media widgets can show and control **Spotify** as their source.
- Give buttons the **Like song**, **Unlike song**, **Dislike song**, **Shuffle** or **Repeat** action.

## If it does not connect

- Check that the redirect URI is exactly `http://127.0.0.1:43821/callback`.
- Spotify only lets the app's owner, and users added under **User Management** in the app's settings, sign in. Create the app with the account you listen on.
