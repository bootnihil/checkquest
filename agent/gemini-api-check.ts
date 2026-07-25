import { GoogleGenAI } from '@google/genai';
import {
  resolveGeminiApiKey
} from './ai/resolve-gemini-api-key';

async function main(): Promise<void> {
  const ai = new GoogleGenAI({
    apiKey:
      resolveGeminiApiKey()
  });

  const interaction = await ai.interactions.create({
    model: 'gemini-3.5-flash',
    input: 'Reply with exactly: Gemini API connection successful',
    store: false,
    generation_config: {
      thinking_level: 'low'
    }
  });

  console.log(interaction.output_text);
}

main().catch((error: unknown) => {
  console.error('Gemini API check failed:', error);
  process.exitCode = 1;
});
