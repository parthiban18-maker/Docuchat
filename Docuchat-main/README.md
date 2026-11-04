# DocuChat — Your PDF, but smarter 🚀

> Upload a PDF and use AI to summarize, extract key points, and chat with your document.

**Live URL:** _https://docuchat-XXXX.onrender.com_ (placeholder — updated after deployment)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Flutter Web (Dart) |
| Backend | Node.js + Express 5 |
| AI | Google Gemini API (gemini-3.8-flash / gemini-2.5-flash + gemini-embedding-001) |
| Hosting | Render (free tier) |

## Features

- 📄 Upload PDF documents (text-based or scanned)
- 📝 AI-generated summaries
- 🔑 Key points extraction
- 💬 RAG-powered chat with your PDF
- 🔍 Semantic search using embeddings

## Run Locally

### Prerequisites

- Node.js 18+
- A free [Google Gemini API key](https://aistudio.google.com/apikey)

### Steps

```bash
cd Docuchat-main/server

# Install dependencies
npm install

# Create .env from the example
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# Start the server
npm start
```

Open http://localhost:3000 in your browser.

## Deploy to Render

1. Push this repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
3. Connect your GitHub repo and select it
4. Render reads `render.yaml` and creates the service
5. In the Render dashboard, set the `GEMINI_API_KEY` environment variable (secret)
6. Deploy!

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Google Gemini API key (free at aistudio.google.com) |
| `PORT` | ❌ | Server port (default: 3000, set by Render automatically) |

## Known Limitations

- **Free tier cold starts**: Render free tier spins down after ~15 min of inactivity. First request after idle takes 30–60 seconds.
- **In-memory storage**: Uploaded documents are stored in server memory and are lost on restart/redeploy. Users need to re-upload PDFs.
- **Rate limits**: Gemini free tier allows ~15 requests/min. Heavy usage may hit rate limits (the app retries automatically with backoff).

## How to Redeploy

Push changes to the `main` branch on GitHub. Render auto-deploys on every push.

```bash
git add -A
git commit -m "Update"
git push origin main
```
