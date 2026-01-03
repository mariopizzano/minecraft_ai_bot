const axios = require('axios');  
const CONFIG = require('./src/config');  
  
const OLLAMA_URL = CONFIG.api_url;  
const SYSTEM_PROMPT = `
You are a Minecraft Autonomous Agent.
Goal: Fulfill the user's high-level COMMAND based on your INVENTORY and STATE.

AVAILABLE ACTIONS (JSON format):
1. GATHER: {"action": "gather", "target": "oak_log", "count": 1} 
   - Use this to get resources like wood, dirt, stone.
2. STOP: {"action": "stop"}
   - Use this immediately if the user says stop.
3. IDLE: {"action": "idle"}
   - Use this if you have completed the task or have nothing to do.
4. FOLLOW: {"action": "follow" }
   - Use this if the user says to follow him to his location. (example keywords: "follow me", "seguimi")

LOGIC RULES:
- If user wants a Crafting Table but you have no wood -> Action is GATHER oak_log.
- If user wants a Crafting Table and you HAVE wood -> (Next module we will implement crafting). For now, IDLE.
- Always check INVENTORY before deciding.
`;
  
async function queryLlama(prompt) {  
    try {  
        const payload = {  
            model: CONFIG.model,  
            prompt: `${SYSTEM_PROMPT}\nCURRENT STATE: ${JSON.stringify(prompt)}`,  
            stream: false, // Importante: vogliamo la risposta completa in un blocco  
            format: "json" // Forza Ollama a tentare un output JSON strutturato  
        };  
  
        const response = await axios.post(OLLAMA_URL, payload);  
        let content = response.data.response;  
  
        // Pulizia difensiva: cerca di estrarre il JSON se il modello aggiunge testo  
        const jsonMatch = content.match(/\[.*\]/s);  
        if (jsonMatch) {  
            content = jsonMatch[0];  
        }  
  
        return JSON.parse(content);  
    } catch (error) {  
        console.error('[Ollama Error] Failed to fetch or parse:', error.message);  
        return []; // Ritorna array vuoto in caso di errore per non bloccare la FSM  
    }  
}  
  
module.exports = { queryLlama };  