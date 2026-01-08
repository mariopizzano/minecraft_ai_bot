const axios = require("axios");
const CONFIG = require("../config");

const OLLAMA_URL = CONFIG.api_url;

async function queryLlama(prompt) {
  try {
    const payload = {
      model: CONFIG.model,
      prompt: `${CONFIG.system_prompt}\nCURRENT STATE: ${JSON.stringify(
        prompt
      )}`,
      stream: false, // Importante: vogliamo la risposta completa in un blocco
      format: "json", // Forza Ollama a tentare un output JSON strutturato
    };

    const response = await axios.post(OLLAMA_URL, payload);
    let content = response.data.response;

    // Pulizia difensiva: cerca di estrarre il JSON se il modello aggiunge testo
    /* const jsonMatch = content.match(/\[.*\]/s);  
        if (jsonMatch) {  
            content = jsonMatch[0];  
        }  
            */
    console.log(content);

    return JSON.parse(content);
  } catch (error) {
    console.error("[Ollama Error] Failed to fetch or parse:", error);
    return []; // Ritorna array vuoto in caso di errore per non bloccare la FSM
  }
}

module.exports = { queryLlama };
