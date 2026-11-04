// =====================================================
// DOCUCHAT — Node.js/Express Backend (Gemini AI)
// =====================================================

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { GoogleGenAI } = require("@google/genai");

const app = express();

app.use(cors());
app.use(express.json());

// =====================================================
// SETTINGS
// =====================================================

const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error(
    "ERROR: GEMINI_API_KEY environment variable is not set.\n" +
      "Get a free key at https://aistudio.google.com/apikey\n" +
      "Then set it: export GEMINI_API_KEY=your-key-here"
  );
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Chat model: gemini-3.5-flash-lite is Google's active, high-throughput free-tier model.
// Fallback to gemini-3.8-flash if desired.
let CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite";

// Embedding model: gemini-embedding-001 (replaces discontinued text-embedding-004)
const EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

// Desired vector dimensions via Matryoshka Representation Learning (MRL)
const EMBEDDING_DIMENSIONS = 768;

// Maximum chunks per document (caps embedding API calls)
const MAX_CHUNKS = 60;

// =====================================================
// MULTER (memory storage, 20 MB limit)
// =====================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// =====================================================
// IN-MEMORY DOCUMENT STORAGE
// =====================================================

const documents = new Map();

// =====================================================
// SERVE FLUTTER WEB BUILD (static files)
// =====================================================

app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", model: CHAT_MODEL });
});

// Keep legacy /health for backward compat
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// =====================================================
// RETRY WITH EXPONENTIAL BACKOFF (429 / 503)
// =====================================================

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error?.status || error?.httpStatusCode || 0;
      const retryable = status === 429 || status === 503;

      if (!retryable || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.log(
        `Rate limited (${status}). Retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// =====================================================
// PDF TEXT EXTRACTION (pdf-parse)
// =====================================================

async function extractPdfText(buffer) {
  const pdfParseModule = await import("pdf-parse");
  const PDFParse = pdfParseModule.PDFParse;

  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

// =====================================================
// GENERATE CONTENT (with automatic model fallback)
// =====================================================

async function generateContentWithFallback(request) {
  try {
    return await withRetry(() =>
      ai.models.generateContent({
        ...request,
        model: CHAT_MODEL,
      })
    );
  } catch (err) {
    const isNotFound =
      err?.status === 404 ||
      (err?.message && (err.message.includes("404") || err.message.includes("not found")));

    if (isNotFound) {
      const fallbackModel = CHAT_MODEL.includes("3.8")
        ? "gemini-2.5-flash"
        : "gemini-3.8-flash";
      console.log(
        `Model ${CHAT_MODEL} not accessible (404). Falling back to ${fallbackModel}...`
      );
      CHAT_MODEL = fallbackModel;
      return await withRetry(() =>
        ai.models.generateContent({
          ...request,
          model: CHAT_MODEL,
        })
      );
    }
    throw err;
  }
}

// =====================================================
// FALLBACK: GEMINI VISION OCR FOR SCANNED PDFs
// =====================================================

async function extractTextWithGemini(pdfBuffer) {
  console.log("Using Gemini vision to OCR scanned PDF...");

  const pdfBase64 = pdfBuffer.toString("base64");

  const response = await generateContentWithFallback({
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            text:
              "Extract ALL text content from this PDF document accurately. " +
              "If it is a scanned/image-based document, perform OCR. " +
              "Preserve the structure and layout. " +
              "Return ONLY the extracted text, no commentary.",
          },
        ],
      },
    ],
  });

  return response.text || "";
}

// =====================================================
// SPLIT TEXT INTO CHUNKS
// =====================================================

function chunkText(text, chunkSize = 1500, overlap = 200) {
  const cleanText = text
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const chunks = [];
  if (!cleanText) return chunks;

  let start = 0;

  while (start < cleanText.length) {
    let end = Math.min(start + chunkSize, cleanText.length);

    if (end < cleanText.length) {
      const paragraphBreak = cleanText.lastIndexOf("\n\n", end);
      const sentenceBreak = cleanText.lastIndexOf(". ", end);
      const bestBreak = Math.max(paragraphBreak, sentenceBreak);

      if (bestBreak > start + chunkSize * 0.6) {
        end = bestBreak + 1;
      }
    }

    const chunk = cleanText.substring(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= cleanText.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

// =====================================================
// CREATE EMBEDDINGS (batched)
// =====================================================

async function createEmbeddings(texts) {
  // Gemini embedContent with gemini-embedding-001
  const response = await withRetry(() =>
    ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    })
  );

  if (!response.embeddings || response.embeddings.length === 0) {
    throw new Error("No embeddings returned by Gemini.");
  }

  return response.embeddings.map((e) => e.values);
}

async function createEmbedding(text) {
  const results = await createEmbeddings([text]);
  return results[0];
}

// =====================================================
// COSINE SIMILARITY
// =====================================================

function cosineSimilarity(vectorA, vectorB) {
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    magnitudeA += vectorA[i] * vectorA[i];
    magnitudeB += vectorB[i] * vectorB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) return 0;

  return dotProduct / (magnitudeA * magnitudeB);
}

// =====================================================
// RETRIEVE RELEVANT CHUNKS (RAG)
// =====================================================

async function retrieveRelevantChunks(question, document, topK = 5) {
  const questionEmbedding = await createEmbedding(question);

  const scoredChunks = document.chunks.map((chunk, index) => {
    const score = cosineSimilarity(questionEmbedding, chunk.embedding);
    return { index, text: chunk.text, score };
  });

  scoredChunks.sort((a, b) => b.score - a.score);

  const topChunks = scoredChunks.slice(0, topK);

  console.log("\nRAG retrieval:");
  topChunks.forEach((chunk, i) => {
    console.log(
      `  Top ${i + 1}: chunk ${chunk.index + 1} | score ${chunk.score.toFixed(4)}`
    );
  });

  return topChunks;
}

// =====================================================
// CALL GEMINI (text generation)
// =====================================================

async function askGemini(prompt) {
  console.log(`\nSending request to ${CHAT_MODEL}...`);
  const startTime = Date.now();

  const response = await generateContentWithFallback({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "You are DocuChat, an AI assistant that answers questions about PDF documents. " +
              "Use only information provided from the PDF. " +
              "Never invent facts. Give only the final answer.\n\n" +
              prompt,
          },
        ],
      },
    ],
    config: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  });

  const answer = response.text || "No response generated.";
  const seconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`AI response generated in ${seconds}s`);

  return answer;
}

// =====================================================
// PREPARE PDF TEXT (truncate for context window)
// =====================================================

function prepareText(text, maxCharacters = 8000) {
  if (text.length <= maxCharacters) return text;
  return (
    text.substring(0, maxCharacters) +
    "\n\n[The document continues beyond this point.]"
  );
}

// =====================================================
// GET DOCUMENT HELPER
// =====================================================

function getDocument(fileId) {
  if (!fileId) return null;
  return documents.get(fileId);
}

// =====================================================
// UPLOAD PDF
// =====================================================

app.post("/api/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF uploaded." });
    }

    console.log("\n==============================");
    console.log("NEW PDF");
    console.log("==============================");
    console.log("Received PDF:", req.file.originalname);
    console.log("Extracting PDF text...");

    let text = "";

    try {
      text = await extractPdfText(req.file.buffer);
    } catch (parseError) {
      console.log("pdf-parse failed:", parseError.message);
    }

    // If pdf-parse got little/no text, try Gemini vision OCR
    if (text.trim().length < 200) {
      console.log("No selectable text found. Using Gemini vision OCR...");

      try {
        text = await extractTextWithGemini(req.file.buffer);
        console.log("Gemini OCR characters:", text.length);

        if (!text.trim()) {
          return res.status(400).json({
            error:
              "No readable text could be extracted from this PDF. The document may be corrupted or contain only images that could not be recognized.",
          });
        }

        console.log("Gemini OCR text extracted successfully.");
      } catch (ocrError) {
        console.error("Gemini OCR failed:", ocrError.message);
        return res.status(400).json({
          error:
            "Could not extract text from this PDF. It may be a scanned document that could not be processed. Please try a text-based PDF.",
        });
      }
    }

    const documentId = Date.now().toString();

    // Split into chunks (capped)
    let chunks = chunkText(text);
    if (chunks.length > MAX_CHUNKS) {
      console.log(
        `Capping chunks from ${chunks.length} to ${MAX_CHUNKS}`
      );
      chunks = chunks.slice(0, MAX_CHUNKS);
    }

    console.log("Chunks created:", chunks.length);
    console.log("Creating embeddings (batched)...");

    // Batch embeddings in groups of 10 to stay under rate limits
    const BATCH_SIZE = 10;
    const embeddedChunks = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await createEmbeddings(batch);

      for (let j = 0; j < batch.length; j++) {
        embeddedChunks.push({
          text: batch[j],
          embedding: embeddings[j],
        });
      }

      console.log(
        `Embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`
      );

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < chunks.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    documents.set(documentId, {
      name: req.file.originalname,
      text: text,
      chunks: embeddedChunks,
    });

    console.log("RAG index ready.");
    console.log("PDF text extracted successfully.");
    console.log("Characters:", text.length);
    console.log("Document ID:", documentId);

    res.json({
      success: true,
      fileId: documentId,
      fileName: req.file.originalname,
      characters: text.length,
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);

    const status = error?.status || error?.httpStatusCode || 0;
    if (status === 429) {
      return res.status(429).json({
        error:
          "AI rate limit reached. Please wait a minute and try again.",
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// SUMMARY
// =====================================================

app.post("/api/summary", async (req, res) => {
  try {
    const { fileId } = req.body;
    const document = getDocument(fileId);

    if (!document) {
      return res.status(404).json({
        error: "PDF not found. Please upload the PDF again.",
      });
    }

    console.log("\nGenerating summary...");

    const pdfText = prepareText(document.text);

    const prompt = `
PDF CONTENT:

--------------------------------
${pdfText}
--------------------------------

Create a clear summary of this PDF.

Use exactly these sections:

DOCUMENT OVERVIEW
Briefly explain what this document is about.

MAIN IDEAS
Explain the main ideas.

IMPORTANT POINTS
List the most important points using bullet points.

IMPORTANT FACTS / NUMBERS / DATES
List important names, dates, numbers, statistics, IDs, definitions.
Only include information actually present in the PDF.

KEY CONCLUSIONS
Explain the main takeaway.

Use ONLY information from the PDF. Do NOT invent information.
Start immediately with: DOCUMENT OVERVIEW
`;

    const summary = await askGemini(prompt);
    console.log("Summary generated successfully.");

    res.json({ success: true, summary: summary });
  } catch (error) {
    console.error("SUMMARY ERROR:", error);

    const status = error?.status || error?.httpStatusCode || 0;
    if (status === 429) {
      return res.status(429).json({
        error: "AI rate limit reached. Please wait a minute and try again.",
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// IMPORTANT POINTS
// =====================================================

app.post("/api/important", async (req, res) => {
  try {
    const { fileId } = req.body;
    const document = getDocument(fileId);

    if (!document) {
      return res.status(404).json({
        error: "PDF not found. Please upload the PDF again.",
      });
    }

    console.log("\nGenerating important points...");

    const pdfText = prepareText(document.text);

    const prompt = `
PDF CONTENT:

--------------------------------
${pdfText}
--------------------------------

Extract the most important information from this PDF.

Use these sections:

MOST IMPORTANT POINTS
IMPORTANT NAMES
IMPORTANT DATES
IMPORTANT NUMBERS
IMPORTANT DEFINITIONS
IMPORTANT FORMULAS
KEY CONCLUSIONS
THINGS TO REMEMBER

If a category is not present in the PDF, write: Not present in this document.

Use ONLY information from the PDF. Do NOT invent facts.
Start immediately with: MOST IMPORTANT POINTS
`;

    const answer = await askGemini(prompt);
    console.log("Important points generated successfully.");

    res.json({ success: true, answer: answer });
  } catch (error) {
    console.error("IMPORTANT POINTS ERROR:", error);

    const status = error?.status || error?.httpStatusCode || 0;
    if (status === 429) {
      return res.status(429).json({
        error: "AI rate limit reached. Please wait a minute and try again.",
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// CHAT WITH PDF
// =====================================================

app.post("/api/chat", async (req, res) => {
  try {
    const { fileId, question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "Question is required." });
    }

    const document = getDocument(fileId);

    if (!document) {
      return res.status(404).json({
        error: "PDF not found. Please upload the PDF again.",
      });
    }

    console.log("\nUser question:", question);

    const relevantChunks = await retrieveRelevantChunks(
      question,
      document,
      5
    );

    const pdfText = relevantChunks
      .map(
        (chunk, index) =>
          `[Relevant Section ${index + 1}]\n${chunk.text}`
      )
      .join("\n\n");

    const prompt = `
PDF CONTENT:

--------------------------------
${pdfText}
--------------------------------

USER QUESTION:

${question}

Answer the user's question using ONLY the PDF.

Rules:
1. Give a direct answer.
2. Keep the answer clear.
3. Use details from the PDF when useful.
4. Do NOT invent information.
5. If the answer cannot be found in the PDF, respond exactly:
   I couldn't find that information in this PDF.

Return only the final answer.
`;

    const answer = await askGemini(prompt);
    console.log("Chat answer generated successfully.");

    res.json({ success: true, answer: answer });
  } catch (error) {
    console.error("CHAT ERROR:", error);

    const status = error?.status || error?.httpStatusCode || 0;
    if (status === 429) {
      return res.status(429).json({
        error: "AI rate limit reached. Please wait a minute and try again.",
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// FALLBACK: serve Flutter Web index.html for non-API
// =====================================================

app.use((req, res, next) => {
  // Only serve index.html for GET requests that are not API calls
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } else {
    next();
  }
});

// =====================================================
// SERVER START
// =====================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("========================================");
  console.log("          DOCUCHAT (Gemini AI)");
  console.log("========================================");
  console.log(`Model  : ${CHAT_MODEL}`);
  console.log(`Embed  : ${EMBEDDING_MODEL}`);
  console.log(`Server : http://0.0.0.0:${PORT}`);
  console.log("AI     : Google Gemini API");
  console.log("========================================");
  console.log("");
  console.log("Ready for PDF uploads.");
  console.log("");
});
