# 🖼️ Memory Album — Private Sanctuary

> *Made a private website for my friends and family to access photos and memories that I uploaded.*

An ultra-modern, full-stack photo album and collection manager with **Firebase Authentication**, **restricted member whitelisting**, and a responsive glassmorphic UI.

---

## ✨ Features

- **🔒 Firebase Authentication**: Secure sign-in powered by Firebase Web SDK.
- **🛡️ Restricted Member Access**: Whitelist gatekeeper ensuring only pre-approved members can access the private collection (public sign-up disabled).
- **🎨 Lumina Design System**:
  - **Lumina Dark (Obsidian Glass)** & **Lumina Light (Frosted Alabaster)** with persistent theme switcher.
  - Fluid Google Typography ([Outfit](https://fonts.google.com/specimen/Outfit) & [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans)).
  - Glassmorphic card surfaces with ambient glowing backdrops and micro-animations.
- **📁 Curated Bento Albums**: Visual album cards with category pills (Places, People, Events) and photo counters.
- **📖 Dedicated Album Detail Workspace**: Hero banner with blurred album cover, breadcrumb navigation, and direct album management.
- **📤 Batch Multi-Photo Uploads**: Multi-file drag-and-drop uploader with live thumbnail previews and progress tracking.
- **🔍 Ultra Lightbox Slideshow**:
  - Keyboard navigation (`←` / `→` / `Esc` / `F`).
  - Smooth Zoom (`-`, `100%`, `+`) up to 300%.
  - Fullscreen view.
  - Image download action.
  - Favorite heart toggling with animated feedback.
  - Slide-out metadata drawer (resolution, file size, upload date, tags).
  - In-place title and tag editing.
- **🏷️ Dynamic Tag Cloud**: Instant 1-click filtering by popular tags.
- **⚡ Atomic Data Persistence**: Safe atomic writes and persistent sessions.

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/image3329/album.git
cd album
npm install
```

### 2. Configure Firebase & Allowed Members
Open `firebase-config.js` and specify your Firebase keys and authorized member emails:
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789...",
  appId: "1:123456789:web:..."
};

const ALLOWED_MEMBERS = [
  "sahimage691@gmail.com",
  "supriya123@gmail.com",
  "niharika@gmail.com",
  "rijangurung@gmail.com"
];
```

### 3. Run Locally
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing

Run backend integration flow tests:
```bash
node test-flow.js
```

Run Playwright end-to-end UI tests:
```bash
npx playwright test test-ui.spec.js
```
