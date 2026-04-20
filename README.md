# Gmail Unsubscriber — Chrome Extension

Automatically unsubscribes you from email lists by finding and executing unsubscribe links in your Gmail inbox.

## How it works

For each sender email address you provide, the extension:

1. **Finds** the most recent email from that sender in Gmail
2. **Extracts** the unsubscribe URL using (in order of preference):
   - `List-Unsubscribe-Post` header → fires a silent one-click POST request (no browser tab needed)
   - `List-Unsubscribe` header → navigates to the URL and clicks the button
   - HTML body parsing → finds the unsubscribe link in the email body
3. **Navigates** to the unsubscribe page in a background tab
4. **Clicks** the unsubscribe button automatically
5. **Closes** the tab and reports success or failure

---

## Setup (one-time, ~10 minutes)

### Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project** → **New Project**
3. Name it `Gmail Unsubscriber` and click **Create**

### Step 2 — Enable Gmail API

1. In your project, go to **APIs & Services → Library**
2. Search for **Gmail API** and click **Enable**

### Step 3 — Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. If prompted, configure the **OAuth consent screen**:
   - User type: **External** (or Internal if you use Google Workspace)
   - App name: `Gmail Unsubscriber`
   - Add your email as a test user
4. Back in Create OAuth client ID:
   - Application type: **Chrome Extension**
   - Name: `Gmail Unsubscriber`
   - For "Item ID", you'll need your extension ID (get it in Step 5 below, then come back)

### Step 4 — Add your Client ID to the extension

1. Copy the **Client ID** from Step 3 (looks like `xxxx.apps.googleusercontent.com`)
2. Open `manifest.json` in this folder
3. Replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID:

```json
"oauth2": {
  "client_id": "123456789-abcdefg.apps.googleusercontent.com",
  ...
}
```

### Step 5 — Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select this folder (`gmail-unsubscriber/`)
5. The extension will appear with an ID like `abcdefghijklmnopqrstuvwxyz123456`
6. **Copy that ID** and go back to Step 3 to add it to your OAuth credentials

### Step 6 — Authorize the extension

1. Click the extension icon in Chrome's toolbar
2. Click **Sign in with Google**
3. Authorize the requested Gmail permissions
4. You're ready to go!

---

## Usage

1. Click the extension icon
2. Paste a list of sender email addresses (one per line)
3. Click **Start**
4. Watch the live progress log — each sender shows ✓ (success) or ✗ (error)

### Tips

- You can paste directly from a spreadsheet — the extension ignores blank lines
- If a sender isn't found in your inbox, it will show `No emails found`
- Some senders require a manual click on their unsubscribe page — these will show as `No unsubscribe button found`
- The extension works best with senders that use standard `List-Unsubscribe` email headers (beehiiv, Mailchimp, Klaviyo, Substack, etc.)

---

## Troubleshooting

**"Authentication failed"**
- Make sure your Client ID is correctly set in `manifest.json`
- Ensure your Google account is added as a test user in the OAuth consent screen
- Try reloading the extension at `chrome://extensions`

**"No emails found from this sender"**
- The sender may have used a different "from" address in the past
- Check Gmail directly to confirm emails exist

**"No unsubscribe button found"**
- The sender uses a non-standard unsubscribe page
- Visit the email manually and use Gmail's built-in unsubscribe button (next to the sender name)

---

## Privacy

- This extension **only reads email headers and bodies** to find unsubscribe links
- It **never stores, transmits, or logs** any email content
- All processing happens locally in your browser
- OAuth tokens are managed by Chrome's identity API and are not accessible outside the extension

---

## File structure

```
gmail-unsubscriber/
├── manifest.json      # Extension config (put your Client ID here)
├── background.js      # Service worker — Gmail API + unsubscribe logic
├── popup.html         # Extension popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup interaction
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md          # This file
```
