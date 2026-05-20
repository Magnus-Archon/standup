# 🎤 Standup — Video Meetings with Smart Notes

> Production-grade video meetings with a built-in AI note-taker.  
> No API keys. No cloud services. Runs entirely on your machine.

---

## Features

| Feature | Details |
|---|---|
| 🎥 Video calls | WebRTC P2P, works in any modern browser |
| 🔗 Join by link or code | Share a link like `abc-defg-hij` |
| 💬 Live chat | In-meeting messaging with unread badge |
| 🖥️ Screen sharing | One-click, no plugins |
| ✋ Hand raise | Visual indicator for all participants |
| 😊 Reactions | Floating emoji reactions |
| 📝 Live transcript | Per-speaker transcript entries during the meeting |
| 🧠 Smart summary | TF-IDF + TextRank — zero LLMs, zero API keys |
| ✅ Action items | Auto-detected with assignee attribution |
| ⚖️ Decisions | Automatically extracted from conversation |
| 🏷️ Key topics | Top keywords from the meeting |
| 🎤 Speaker stats | Talk-time %, word count per participant |
| 😊 Sentiment | Lexicon-based meeting mood analysis |

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+

### Run

```bash
# Option 1: use the start script
chmod +x start.sh
./start.sh

# Option 2: manual
pip install -r requirements.txt
cd frontend && npm install && cd ..
cd backend && python3 main.py
```

Open **http://localhost:8000** in your browser.

---

## How to Use

### Start a meeting
1. Click **New meeting** on the home page
2. Allow camera/microphone access
3. Enter your name and click **Join Meeting**
4. Share the link or code with others

### Join a meeting
1. Enter the code (e.g. `abc-defg-hij`) in the join field, or open the shared link
2. Enter your name and join

### Controls

| Button | Action |
|---|---|
| 🎙️ | Toggle microphone |
| 📹 | Toggle camera |
| 🖥️ | Start/stop screen share |
| ✋ | Raise/lower hand |
| 😊 | Send emoji reaction |
| 📝 | Add transcript entry |
| 💬 | Open chat panel |
| 📋 | Open notes & summary panel |
| **Leave** | End your session |

### Smart Note-Taker

During the meeting, click **📝** (transcript button) to add what was said.  
After the meeting (or during), open the **Notes** panel → **Summary** tab → **Generate Summary**.

The NLP engine will produce:
- **Summary** (top sentences by TextRank score)
- **Action items** (with assignee detection)
- **Decisions made**
- **Key topics**
- **Questions raised**
- **Speaker talk-time stats**
- **Meeting sentiment**

---

## Architecture

```
standup/
├── backend/
│   ├── main.py          # FastAPI + Socket.IO server
│   └── nlp_engine.py    # Pure Python NLP summarizer
├── frontend/
│   └── app/
│       ├── page.tsx               # Home page
│       ├── meet/[code]/page.tsx   # Meeting room
│       └── components/
│           ├── VideoTile.tsx      # Participant video tile
│           ├── ChatPanel.tsx      # Chat sidebar
│           └── TranscriptPanel.tsx # Transcript + summary
├── requirements.txt
├── start.sh
└── README.md
```

### NLP Pipeline (no API, no GPU needed)

```
Transcript entries
      ↓
Sentence splitting (pure regex)
      ↓
TF-IDF vectorization (sklearn)
      ↓
Cosine similarity matrix
      ↓
TextRank scoring (power iteration)
      ↓
Extractive summary (top-N sentences)
      ↓
+ Pattern matching for actions, decisions, questions
+ Lexicon-based sentiment
+ Bigram topic extraction
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PORT` | `3000` | Port for the Next.js dev server |

---

## Production Deployment

For a real deployment, build Next.js first:

```bash
cd frontend
npm run build
npm start &   # or use pm2
```

Then run the backend with:
```bash
cd backend
NEXT_PORT=3000 uvicorn main:socket_app --host 0.0.0.0 --port 8000 --workers 1
```

> Note: Socket.IO requires a single worker (no multiple processes without Redis adapter).

---

## Tech Stack

- **Backend**: FastAPI, python-socketio, uvicorn
- **Frontend**: Next.js 16, TypeScript
- **Video**: WebRTC (native browser API)
- **NLP**: scikit-learn TF-IDF, pure Python TextRank
- **Signaling**: Socket.IO WebSocket
