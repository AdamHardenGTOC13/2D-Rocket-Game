import { GoogleGenAI } from "@google/genai";
import { RocketPart } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeMission = async (parts: RocketPart[]) => {
  // Construct a text representation of the rocket
  const rocketDescription = parts.map((p, index) => 
    `${index + 1}. ${p.name} (${p.type}) - Mass: ${p.mass}kg` + 
    (p.fuelCapacity ? `, Fuel: ${p.fuelCapacity}kg` : '') +
    (p.thrust ? `, Thrust: ${p.thrust}N` : '')
  ).join('\n');

  const prompt = `
    You are a sarcastic but brilliant rocket scientist at Mission Control. 
    Analyze the following rocket design (listed from top to bottom):
    
    ${rocketDescription}

    Provide a JSON response with the following structure:
    {
      "missionName": "A cool name for this rocket",
      "analysis": "A short paragraph analyzing the TWR (Thrust to Weight Ratio) and fuel capacity. Will it fly?",
      "successProbability": "A number between 0 and 100",
      "tips": ["Short bullet point 1", "Short bullet point 2"]
    }
    
    Keep it brief and fun.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });
    
    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    throw error;
  }
};