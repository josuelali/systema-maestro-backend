import express from "express";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import cors from "cors";

dotenv.config();

const app = express();

/* =========================
   CORS ABIERTO (TEMPORAL)
   Para que funcione YA
========================= */

app.use(cors());
app.options("*", cors());

app.use(express.json({ limit: "1mb" }));

/* =========================
   GROQ CLIENT
========================= */

if (!process.env.GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY no definida");
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/* =========================
   ROUTES
========================= */

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Backend operativo" });
});

app.post("/generate", async (req, res) => {
  try {
    const prompt = req.body?.prompt;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt requerido" });
    }

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `
Eres un generador profesional de landing pages SaaS monetizables.

Devuelve SIEMPRE:

1. H1 optimizado SEO
2. Subheadline persuasiva
3. Sección problema
4. Sección solución
5. Beneficios en bullets
6. CTA potente
7. Estructura HTML lista para copiar

Sin explicaciones. Solo contenido estructurado.
`
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const result = completion?.choices?.[0]?.message?.content ?? "";

    return res.status(200).json({ result });

  } catch (error: any) {
    console.error("ERROR REAL GROQ:", error?.response?.data || error?.message || error);
    return res.status(500).json({ error: "Error generando contenido" });
  }
});

/* =========================
   PORT RENDER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
