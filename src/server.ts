import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// CORS simple
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Backend OpenAI operativo" });
});

app.post("/generate", async (req, res) => {
  try {
    const prompt = req.body?.prompt;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt requerido" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Falta OPENAI_API_KEY en variables de entorno"
      });
    }

    const systemPrompt = `
Eres un generador profesional de landing pages SaaS monetizables.

Devuelve SIEMPRE y solo esto:

1. H1 optimizado SEO
2. Subheadline persuasiva
3. Sección problema
4. Sección solución
5. Beneficios en bullets
6. CTA potente
7. Estructura HTML lista para copiar

No expliques nada fuera de la respuesta.
No uses introducciones.
No uses markdown complejo.
Sé claro, directo, vendedor y orientado a conversión.
`.trim();

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        input: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: prompt.trim()
          }
        ],
        max_output_tokens: 900
      })
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error("ERROR REAL OPENAI:", data);
      return res.status(openaiResponse.status).json({
        error: data?.error?.message || "Error generando contenido con OpenAI"
      });
    }

    const result = data.output_text || "";

    return res.status(200).json({ result });
  } catch (error) {
    console.error("ERROR SERVIDOR OPENAI:", error);
    return res.status(500).json({ error: "Error generando contenido" });
  }
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
