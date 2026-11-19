Shows who is in your Discord voice channel and lets dashboard buttons mute, deafen, leave and rejoin. It talks to the **Discord desktop app** on this PC. The browser version does not work.

Connecting needs a free Discord application of your own.

## 1. Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and sign in with the account you use in the Discord app.
2. Click **New Application**, name it `SupaDashboard`, accept the terms and click **Create**.
3. Open **OAuth2** in the left menu.
4. Under **Redirects**, click **Add Redirect** and enter `http://127.0.0.1`.
5. Turn on **Public Client**, then click **Save Changes**.
6. Copy the **Client ID** at the top of the page.

## 2. Connect

1. Paste the Client ID into **Client ID** in the Connection section of this page.
2. Click **Connect**. Discord opens an authorization window: click **Authorize**.
3. Status changes to **Connected as** your name. SupaDashboard reconnects whenever Discord starts.

## 3. Use it

- In **Layout**, add the **Voice channel** widget. It shows everyone in your channel and who is speaking, muted or deafened.
- Give any button the **Toggle mute**, **Toggle deafen**, **Leave channel** or **Rejoin last channel** action.
- Use the `discord.muted`, `discord.deafened` and `discord.inChannel` variables to change how a button looks while you are muted, deafened or in a channel.

## If it does not connect

- **Not running**: start the Discord desktop app on this PC.
- If **Plugin not set up** remains after you authorize, check the redirect `http://127.0.0.1` and the **Public Client** setting.
- Discord only lets the account that owns the application use voice control. Create the application with the same account you use in the Discord app.
