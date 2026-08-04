import { GoogleGenAI } from '@google/genai';

function main(): void {
  const sdkLoaded = typeof GoogleGenAI === 'function';

  console.log(`Gemini SDK loaded: ${sdkLoaded}`);
}

main();
