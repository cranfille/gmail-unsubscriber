---
layout: default
title: Gmail Unsubscriber
description: A Chrome extension that automatically unsubscribes you from unwanted email mailing lists.
---

# Gmail Unsubscriber

A Chrome extension that automatically unsubscribes you from unwanted email mailing lists. Paste a list of sender addresses, click Start, and the extension finds and executes the unsubscribe link for each one — all locally, with no data leaving your browser.

---

## Legal

| Document | Description | Last Updated |
|----------|-------------|--------------|
| [Privacy Policy](./privacy-policy.html) | How the extension handles your data | April 20, 2026 |

---

## How It Works

1. **You provide** a list of sender email addresses
2. **The extension searches** your Gmail inbox for the most recent email from each sender
3. **It extracts** the unsubscribe link from the email headers or body
4. **It navigates** to the unsubscribe page in a background tab and clicks the button
5. **The tab closes** automatically and the result is logged

All processing happens locally in your browser. No email content is stored or transmitted anywhere.

---

## Permissions

The extension requests the following Chrome permissions:

- **`identity`** — Signs you in with Google via OAuth to access Gmail
- **`tabs`** — Opens and closes temporary background tabs for unsubscribe pages
- **`scripting`** — Clicks the unsubscribe button on landing pages
- **`storage`** — Saves run summaries locally on your device
- **`alarms`** — Keeps the background worker alive during long jobs
- **Host permissions** — Visits unsubscribe URLs sourced from your own emails

---

## Source

View the source code and installation instructions in the [repository](../../).
