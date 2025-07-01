// Use ES Modules 'import' for Vercel Functions.
import { GoogleGenAI } from "@google/genai";

const systemInstruction = `You are a helpful assistant and a creative video director.
If the user asks for a regular chat response, provide a clear, concise, and helpful answer in markdown.
If the user explicitly asks for a "video explanation", "show me a video", "make a video", or a similar request, you MUST respond with ONLY a valid JSON object. Do not include any other text or markdown fences like \`\`\`json.
The JSON object must represent a video script and follow this structure:
{
  "scenes": [
    {
      "narration": "Text to be spoken for this scene. Keep it brief, one clear sentence.",
      "image_prompt": "A detailed, descriptive prompt for an image generation model to create a visual for this scene. The prompt should describe a visually appealing and interesting image. For example 'A photorealistic image of...' or 'An epic fantasy painting of...'"
    }
  ]
}
For all other requests, just chat normally.`;

// Vercel's handler uses a standard (req, res) signature.
export default async function handler(req, res) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "API_KEY environment variable not set." } });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method Not Allowed' } });
  }

  if (!req.body) {
    return res.status(400).json({ error: { message: "Request body is missing." } });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    // Vercel automatically parses the JSON body.
    const { type, payload } = req.body;

    if (type === 'chat') {
      const { history, message } = payload;
      
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash-preview-04-17',
        history: history,
        config: {
          systemInstruction: systemInstruction
        }
      });
      const result = await chat.sendMessage(message);
      return res.status(200).json({ text: result.text });

    } else if (type === 'image') {
      const { prompt } = payload;
      const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: prompt,
        config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
      });
      const base64Image = response.generatedImages[0].image.imageBytes;
      return res.status(200).json({ image: base64Image });
      
    } else {
      return res.status(400).json({ error: { message: "Invalid request type." } });
    }
  } catch (error) {
    console.error("API Error:", error);
    const errorMessage = error.message || "An internal server error occurred.";
    return res.status(500).json({ error: { message: errorMessage } });
  }
}
