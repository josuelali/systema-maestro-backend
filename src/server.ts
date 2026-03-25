import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

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
Eres un generador profesional de ideas de negocio y landings monetizables.

Responde siempre en español y de forma clara.

Devuelve exactamente estas secciones:

1. Nombre del sistema
2. Propuesta principal
3. Modelo de monetización recomendado
4. Estructura de la landing
5. Primeros pasos para lanzarlo
6. CTA final potente

No uses introducciones largas.
No uses markdown complejo.
No expliques fuera de esas secciones.
Sé directo, útil y orientado a ingresos.
    `.trim();

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: prompt.trim()
          }
        ],
        temperature: 0.7,
        max_tokens: 900
      })
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error("ERROR REAL OPENAI:", data);
      return res.status(openaiResponse.status).json({
        error: data?.error?.message || "Error generando contenido con OpenAI"
      });
    }

    const result = data?.choices?.[0]?.message?.content?.trim();

    if (!result) {
      console.error("RESPUESTA OPENAI VACÍA:", JSON.stringify(data, null, 2));
      return res.status(500).json({
        error: "OpenAI respondió, pero no devolvió texto útil"
      });
    }

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
