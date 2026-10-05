const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

// =====================================================
// SETTINGS
// =====================================================

const PORT = 3000;

const OLLAMA_URL =
  "http://localhost:11434/api/chat";

const MODEL = "qwen3:1.7b";
// =====================================================
// TEMPORARY PDF STORAGE
// =====================================================

const documents = new Map();

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
  res.json({
    message: "DocuChat Local AI backend is running!",
    model: MODEL,
  });
});
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
  });
});
// =====================================================
// PDF TEXT EXTRACTION
// =====================================================

async function extractPdfText(buffer) {
  const pdfParseModule =
    await import("pdf-parse");

  const PDFParse =
    pdfParseModule.PDFParse;

  const parser = new PDFParse({
    data: buffer,
  });

  try {
    const result =
      await parser.getText();

    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

// =====================================================
// UPLOAD PDF
// =====================================================

app.post(
  "/upload",
  upload.single("pdf"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No PDF uploaded.",
        });
      }

      console.log("");
      console.log("==============================");
      console.log("NEW PDF");
      console.log("==============================");

      console.log(
        "Received PDF:",
        req.file.originalname
      );

      console.log(
        "Extracting PDF text..."
      );

      let text =
        await extractPdfText(
          req.file.buffer
        );

      if (text.trim().length < 200) {
  console.log(
    "No selectable text found. Starting OCR..."
  );

  text = await extractTextWithOCR(
    req.file.buffer
  );

  console.log(
    "OCR characters:",
    text.length
  );

  if (!text.trim()) {
    return res.status(400).json({
      error:
        "No readable text could be extracted from this PDF.",
    });
  }

  console.log(
    "OCR text extracted successfully."
  );
}

      const documentId =
  Date.now().toString();

// Split complete PDF into chunks
const chunks = chunkText(text);

console.log(
  "Chunks created:",
  chunks.length
);

console.log(
  "Creating embeddings..."
);

const embeddedChunks = [];

for (let i = 0; i < chunks.length; i++) {
  const embedding =
    await createEmbedding(
      chunks[i]
    );

  embeddedChunks.push({
    text: chunks[i],
    embedding: embedding,
  });

  if (
    (i + 1) % 10 === 0 ||
    i === chunks.length - 1
  ) {
    console.log(
      `Embedded ${i + 1}/${chunks.length}`
    );
  }
}

documents.set(
  documentId,
  {
    name:
      req.file.originalname,

    text: text,

    chunks: embeddedChunks,
  }
);

console.log(
  "RAG index ready."
);

      console.log(
        "PDF text extracted successfully."
      );

      console.log(
        "Characters:",
        text.length
      );

      console.log(
        "Document ID:",
        documentId
      );

      res.json({
        success: true,

        fileId:
          documentId,

        fileName:
          req.file.originalname,

        characters:
          text.length,
      });
    } catch (error) {
      console.error(
        "UPLOAD ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

// =====================================================
// CLEAN QWEN OUTPUT
// =====================================================

function cleanAIResponse(text) {
  if (!text) {
    return "No response generated.";
  }

  let answer = text;

  // ---------------------------------------------
  // Remove complete <think>...</think>
  // ---------------------------------------------

  answer = answer.replace(
    /<think>[\s\S]*?<\/think>/gi,
    ""
  );

  // ---------------------------------------------
  // Sometimes Qwen returns reasoning followed
  // only by </think>
  // ---------------------------------------------

  if (
    answer
      .toLowerCase()
      .includes("</think>")
  ) {
    const parts =
      answer.split(
        /<\/think>/i
      );

    answer =
      parts[
        parts.length - 1
      ];
  }

  // ---------------------------------------------
  // Remove Thinking...done thinking format
  // ---------------------------------------------

  answer = answer.replace(
    /Thinking\.\.\.[\s\S]*?\.\.\.done thinking\./gi,
    ""
  );

  // ---------------------------------------------
  // Remove remaining think tags
  // ---------------------------------------------

  answer = answer.replace(
    /<\/?think>/gi,
    ""
  );

  return answer.trim();
}

// =====================================================
// CREATE EMBEDDING WITH OLLAMA
// =====================================================
const OLLAMA_EMBED_URL =
  "http://localhost:11434/api/embed";

const EMBEDDING_MODEL =
  "nomic-embed-text";

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `${command} failed: ${stderr || error.message}`
          )
        );
        return;
      }

      resolve(stdout);
    });
  });
}
async function extractTextWithOCR(pdfBuffer) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "docuchat-ocr-")
  );

  const pdfPath = path.join(tempDir, "document.pdf");
  const outputPrefix = path.join(tempDir, "page");

  try {
    fs.writeFileSync(pdfPath, pdfBuffer);

    console.log("OCR: Converting PDF pages to images...");

   await runCommand(
  "C:\\Users\\moham\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftoppm.exe",
  ["-jpeg",
      "-r",
      "200",
      pdfPath,
      outputPrefix,
]);

    const imageFiles = fs
      .readdirSync(tempDir)
      .filter((file) => file.endsWith(".jpg"))
      .sort();

    console.log(
      `OCR: ${imageFiles.length} page image(s) created.`
    );

    let ocrText = "";

    for (let i = 0; i < imageFiles.length; i++) {
      const imagePath = path.join(
        tempDir,
        imageFiles[i]
      );

      console.log(
        `OCR: Reading page ${i + 1}/${imageFiles.length}...`
      );

      const pageText = await runCommand(
  "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
  [
    imagePath,
    "stdout",
    "-l",
    "eng",
  ]
);

      ocrText += `\n\n${pageText}`;
    }

    return ocrText.trim();
  } finally {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  }
}
async function createEmbedding(text) {
  const response = await fetch(
    OLLAMA_EMBED_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    }
  );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Embedding error ${response.status}: ${errorText}`
    );
  }

  const data =
    await response.json();

  if (
    !data.embeddings ||
    !data.embeddings[0]
  ) {
    throw new Error(
      "No embedding returned by Ollama."
    );
  }

  return data.embeddings[0];
}function cosineSimilarity(vectorA, vectorB) {
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

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}
// =====================================================
// RETRIEVE RELEVANT PDF CHUNKS
// =====================================================

async function retrieveRelevantChunks(
  question,
  document,
  topK = 5
) {
  // Create embedding for user's question
  const questionEmbedding =
    await createEmbedding(question);

  // Compare question with every PDF chunk
  const scoredChunks =
    document.chunks.map((chunk, index) => {
      const score = cosineSimilarity(
        questionEmbedding,
        chunk.embedding
      );

      return {
        index: index,
        text: chunk.text,
        score: score,
      };
    });

  // Highest similarity first
  scoredChunks.sort(
    (a, b) => b.score - a.score
  );

  // Take only the most relevant chunks
  const topChunks =
    scoredChunks.slice(0, topK);

  console.log("");
  console.log("RAG retrieval:");

  topChunks.forEach((chunk, i) => {
    console.log(
      `Top ${i + 1}: chunk ${chunk.index + 1} | score ${chunk.score.toFixed(4)}`
    );
  });

  return topChunks;
}
// =====================================================
// CALL LOCAL OLLAMA
// =====================================================

async function askOllama(prompt) {
  console.log("");
  console.log(`Sending request to ${MODEL}...`);

  const startTime = Date.now();

  const response =
    await fetch(
      OLLAMA_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          model: MODEL,

          stream: false,

          // Disable Qwen reasoning
          think: false,

          messages: [
            {
              role: "system",

              content:
                "You are DocuChat, an AI assistant " +
                "that answers questions about PDF documents. " +
                "Use only information provided from the PDF. " +
                "Never invent facts. " +
                "Never reveal internal reasoning. " +
                "Never output thinking steps. " +
                "Give only the final answer.",
            },

            {
              role: "user",
              content: prompt,
            },
          ],

          options: {
            temperature: 0.1,
            num_predict: 300,
            num_ctx: 4096
          },
        }),
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Ollama error ${response.status}: ${errorText}`
    );
  }

  const data =
    await response.json();

  let answer =
    data.message?.content ||
    "No response generated.";

  // Extra protection:
  // strip reasoning if model returns it anyway.

  answer =
    cleanAIResponse(
      answer
    );

  const seconds =
    (
      (Date.now() - startTime) /
      1000
    ).toFixed(1);

  console.log(
    `AI response generated in ${seconds}s`
  );

  return answer;
}
// =====================================================
// SPLIT PDF INTO CHUNKS
// =====================================================

function chunkText(text, chunkSize = 1500, overlap = 200) {
  const cleanText = text
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const chunks = [];

  if (!cleanText) {
    return chunks;
  }

  let start = 0;

  while (start < cleanText.length) {
    let end = Math.min(
      start + chunkSize,
      cleanText.length
    );

    // Try not to cut in the middle of a paragraph/sentence.
    if (end < cleanText.length) {
      const paragraphBreak =
        cleanText.lastIndexOf("\n\n", end);

      const sentenceBreak =
        cleanText.lastIndexOf(". ", end);

      const bestBreak =
        Math.max(paragraphBreak, sentenceBreak);

      if (
        bestBreak > start + chunkSize * 0.6
      ) {
        end = bestBreak + 1;
      }
    }

    const chunk =
      cleanText.substring(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= cleanText.length) {
      break;
    }

    start = Math.max(
      end - overlap,
      start + 1
    );
  }

  return chunks;
}
// =====================================================
// PREPARE PDF TEXT
// =====================================================

function prepareText(
  text,
  maxCharacters = 8000
) {
  if (
    text.length <=
    maxCharacters
  ) {
    return text;
  }

  return (
    text.substring(
      0,
      maxCharacters
    ) +
    "\n\n" +
    "[The document continues beyond this point.]"
  );
}

// =====================================================
// GET DOCUMENT
// =====================================================

function getDocument(fileId) {
  if (!fileId) {
    return null;
  }

  return documents.get(
    fileId
  );
}

// =====================================================
// SUMMARY
// =====================================================

app.post(
  "/summary",
  async (req, res) => {
    try {
      const {
        fileId,
      } = req.body;

      const document =
        getDocument(
          fileId
        );

      if (!document) {
        return res
          .status(404)
          .json({
            error:
              "PDF not found. Please upload the PDF again.",
          });
      }

      console.log("");
      console.log(
        "Generating summary..."
      );

      const pdfText =
        prepareText(
          document.text
        );

      const prompt = `
PDF CONTENT:

--------------------------------
${pdfText}
--------------------------------

Create a clear summary of this PDF.

Return ONLY the final summary.

Do NOT show:
- reasoning
- analysis
- thinking
- internal steps

Use exactly these sections:

DOCUMENT OVERVIEW

Briefly explain what this document is about.

MAIN IDEAS

Explain the main ideas.

IMPORTANT POINTS

List the most important points using bullet points.

IMPORTANT FACTS / NUMBERS / DATES

List important:
- names
- dates
- numbers
- statistics
- IDs
- definitions

Only include information actually present in the PDF.

KEY CONCLUSIONS

Explain the main takeaway.

IMPORTANT RULES:

Use ONLY information from the PDF.

Do NOT invent information.

Do NOT reveal your reasoning.

Do NOT write <think> tags.

Start immediately with:

DOCUMENT OVERVIEW
`;

      const summary =
        await askOllama(
          prompt
        );

      console.log(
        "Summary generated successfully."
      );

      res.json({
        success: true,
        summary: summary,
      });
    } catch (error) {
      console.error(
        "SUMMARY ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

// =====================================================
// IMPORTANT POINTS
// =====================================================

app.post(
  "/important",
  async (req, res) => {
    try {
      const {
        fileId,
      } = req.body;

      const document =
        getDocument(
          fileId
        );

      if (!document) {
        return res
          .status(404)
          .json({
            error:
              "PDF not found. Please upload the PDF again.",
          });
      }

      console.log("");
      console.log(
        "Generating important points..."
      );

      const pdfText =
        prepareText(
          document.text
        );

      const prompt = `
PDF CONTENT:

--------------------------------
${pdfText}
--------------------------------

Extract the most important information from this PDF.

Return ONLY the final answer.

Do NOT show your reasoning or thinking.

Use these sections:

MOST IMPORTANT POINTS

IMPORTANT NAMES

IMPORTANT DATES

IMPORTANT NUMBERS

IMPORTANT DEFINITIONS

IMPORTANT FORMULAS

KEY CONCLUSIONS

THINGS TO REMEMBER

If a category is not present in the PDF,
write:

Not present in this document.

Rules:

Use ONLY information from the PDF.

Do NOT invent facts.

Do NOT show analysis.

Do NOT show thinking.

Do NOT output <think> tags.

Start immediately with:

MOST IMPORTANT POINTS
`;

      const answer =
        await askOllama(
          prompt
        );

      console.log(
        "Important points generated successfully."
      );

      res.json({
        success: true,
        answer: answer,
      });
    } catch (error) {
      console.error(
        "IMPORTANT POINTS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

// =====================================================
// CHAT WITH PDF
// =====================================================

app.post(
  "/chat",
  async (req, res) => {
    try {
      const {
        fileId,
        question,
      } = req.body;

      if (
        !question ||
        !question.trim()
      ) {
        return res
          .status(400)
          .json({
            error:
              "Question is required.",
          });
      }

      const document =
        getDocument(
          fileId
        );

      if (!document) {
        return res
          .status(404)
          .json({
            error:
              "PDF not found. Please upload the PDF again.",
          });
      }

      console.log("");
      console.log(
        "User question:",
        question
      );

      // Retrieve the most relevant chunks from the entire PDF
const relevantChunks =
  await retrieveRelevantChunks(
    question,
    document,
    5
  );

// Combine retrieved chunks into context for Qwen
const pdfText =
  relevantChunks
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

5. Do NOT show reasoning.

6. Do NOT show thinking.

7. Do NOT output <think> tags.

8. If the answer cannot be found in the PDF,
respond exactly:

I couldn't find that information in this PDF.

Return only the final answer.
`;

      const answer =
        await askOllama(
          prompt
        );

      console.log(
        "Chat answer generated successfully."
      );

      res.json({
        success: true,
        answer: answer,
      });
    } catch (error) {
      console.error(
        "CHAT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

// =====================================================
// SERVER START
// =====================================================

app.listen(
  PORT,
  () => {
    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      "          DOCUCHAT LOCAL AI"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Model  : ${MODEL}`
    );

    console.log(
      `Server : http://localhost:${PORT}`
    );

    console.log(
      "AI     : Ollama (Local)"
    );

    console.log(
      "========================================"
    );

    console.log("");
    console.log(
      "Ready for PDF uploads."
    );

    console.log("");
  }
);