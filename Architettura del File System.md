  
## Architettura del File System  
Questa struttura separa la logica di connessione (Mineflayer), l'intelligenza (Ollama/Llama) e l'esecuzione (FSM).  
Plaintext  
  
my-bot-project/  
├── package.json  
├── index.js                # Entry point: Inizializzazione e Listener Chat  
├── src/  
│   ├── config.js           # Configurazioni (host, port, username)  
│   ├── core/  
│   │   ├── fsm.js          # Il cuore: Finite State Machine (Queue & Interrupts)  
│   │   └── actionMap.js    # Traduce i verbi JSON in funzioni Mineflayer  
│   ├── services/  
│   │   ├── ollama.js       # Client HTTP per comunicare con Llama 3.1  
│   │   └── perception.js   # Raccoglie i dati sensoriali per il prompt  
│   └── utils/  
│       └── logger.js       # Utility per log strutturati  
  
## 1. Preparazione (package.json)  
Ti serviranno queste librerie. mineflayer-pathfinder è obbligatoria per trasformare un comando "move" in un calcolo A* (A-Star).  
Bash  
  
npm init -y  
npm install mineflayer mineflayer-pathfinder axios  
## 2. Il Servizio AI (src/services/ollama.js)  
Questo modulo gestisce la comunicazione con l'istanza locale di Ollama. Include una pulizia del JSON, dato che gli LLM a volte aggiungono testo superfluo prima o dopo il blocco di codice.  
JavaScript  
  
const axios = require('axios');  
  
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';  
  
async function queryLlama(prompt, model = 'llama3.1') {  
    try {  
        const payload = {  
            model: model,  
            prompt: prompt,  
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
## 3. La Percezione (src/services/perception.js)  
Crea il contesto da passare a Llama.  
JavaScript  
  
function getBotState(bot) {  
    // Filtriamo solo ciò che serve per ridurre i token  
    const inventory = bot.inventory.items().map(item => ({  
        name: item.name,  
        count: item.count  
    }));  
  
    const position = {  
        x: Math.floor(bot.entity.position.x),  
        y: Math.floor(bot.entity.position.y),  
        z: Math.floor(bot.entity.position.z)  
    };  
  
    // Rileva nemici entro 15 blocchi  
    const threats = Object.values(bot.entities)  
        .filter(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 15)  
        .map(e => ({ type: e.name, dist: Math.floor(e.position.distanceTo(bot.entity.position)) }));  
  
    return {  
        health: bot.health,  
        food: bot.food,  
        position: position,  
        inventory: inventory,  
        nearby_threats: threats,  
        is_day: bot.time.timeOfDay < 13000  
    };  
}  
  
module.exports = { getBotState };  
## 4. Mappatura Azioni (src/core/actionMap.js)  
Qui colleghi i verbi stringa del JSON alle funzioni reali di Mineflayer. Ogni funzione ritorna una Promise.  
JavaScript  
  
const { goals } = require('mineflayer-pathfinder');  
  
// Factory function per avere accesso all'istanza 'bot'  
function createActionExecutor(bot) {  
    return {  
        move: async (params) => {  
            const { x, y, z } = params;  
            console.log(`[Action] Moving to ${x}, ${y}, ${z}`);  
            const goal = new goals.GoalBlock(x, y, z);  
            bot.pathfinder.setGoal(goal);  
              
            // Promise custom per gestire l'evento di arrivo  
            return new Promise((resolve, reject) => {  
                const cleanUp = () => {  
                    bot.removeListener('goal_reached', onSuccess);  
                    bot.removeListener('path_update', onPathUpdate); // Esempio di gestione errori  
                };  
  
                const onSuccess = () => {  
                    cleanUp();  
                    console.log('[Action] Move complete.');  
                    resolve();  
                };  
  
                const onPathUpdate = (r) => {  
                    if (r.status === 'noPath') {  
                        cleanUp();  
                        console.log('[Action] No path found.');  
                        resolve(); // Risolviamo comunque per passare al prossimo task  
                    }  
                };  
  
                bot.once('goal_reached', onSuccess);  
                bot.on('path_update', onPathUpdate);  
            });  
        },  
  
        chat: async (params) => {  
            bot.chat(params.message);  
            return Promise.resolve(); // Azione istantanea  
        },  
          
        // Aggiungi qui: mine, attack, craft, etc.  
        fallback: async () => {  
            console.log("[Action] Unknown command.");  
            return Promise.resolve();  
        }  
    };  
}  
  
module.exports = { createActionExecutor };  
## 5. Il Cuore: La FSM (src/core/fsm.js)  
Questa classe implementa la logica a eventi discussa.  
JavaScript  
  
const EventEmitter = require('events');  
const { createActionExecutor } = require('./actionMap');  
  
class BotBrain extends EventEmitter {  
    constructor(bot) {  
        super();  
        this.bot = bot;  
        this.queue = [];  
        this.isBusy = false;  
        this.executor = createActionExecutor(bot);  
          
        // Setup listener per interruzioni  
        this.setupInterrupts();  
    }  
  
    // Aggiunge un piano alla coda  
    enqueuePlan(planArray) {  
        console.log(`[FSM] Received plan with ${planArray.length} steps.`);  
        this.queue.push(...planArray);  
        this.processNext();  
    }  
  
    // Inserisce priorità alta (es. scappa)  
    emergencyOverride(action) {  
        console.log('[FSM] EMERGENCY OVERRIDE TRIGGERED');  
        this.queue = []; // Opzionale: cancella piano corrente o lo mette in pausa  
        this.queue.unshift(action);  
        this.bot.pathfinder.setGoal(null); // Stop immediato movimento  
        this.isBusy = false; // Reset flag per forzare esecuzione immediata  
        this.processNext();  
    }  
  
    async processNext() {  
        if (this.isBusy) return;  
        if (this.queue.length === 0) {  
            console.log('[FSM] Queue empty. Idling.');  
            return;  
        }  
  
        this.isBusy = true;  
        const task = this.queue.shift();  
          
        try {  
            const actionFn = this.executor[task.type] || this.executor.fallback;  
            await actionFn(task);  
        } catch (error) {  
            console.error('[FSM] Execution Error:', error);  
        } finally {  
            this.isBusy = false;  
            // Ricorsione asincrona tramite event loop  
            setImmediate(() => this.processNext());  
        }  
    }  
  
    setupInterrupts() {  
        // Esempio: Se prendiamo danno, scatta l'allarme  
        this.bot.on('entityHurt', (entity) => {  
            if (entity === this.bot.entity) {  
                // Logica semplice: se colpiti, diciamo qualcosa (o scappiamo)  
                // In un caso reale, qui genereresti un task "attack" o "run"  
                console.log('[Interrupt] Bot was hurt!');  
            }  
        });  
    }  
}  
  
module.exports = { BotBrain };  
## 6. Entry Point (index.js)  
Collega tutto insieme.  
JavaScript  
  
const mineflayer = require('mineflayer');  
const { pathfinder, Movements } = require('mineflayer-pathfinder');  
const { BotBrain } = require('./src/core/fsm');  
const { queryLlama } = require('./src/services/ollama');  
const { getBotState } = require('./src/services/perception');  
  
const bot = mineflayer.createBot({  
    host: 'localhost',  
    port: 25565,  
    username: 'LlamaBot'  
});  
  
// Carica plugin  
bot.loadPlugin(pathfinder);  
  
let brain;  
  
bot.once('spawn', () => {  
    // Inizializza movimenti standard  
    const mcData = require('minecraft-data')(bot.version);  
    const defaultMove = new Movements(bot, mcData);  
    bot.pathfinder.setMovements(defaultMove);  
  
    // Inizializza il cervello  
    brain = new BotBrain(bot);  
    console.log('[System] Bot spawned and Brain active.');  
});  
  
bot.on('chat', async (username, message) => {  
    if (username === bot.username) return;  
      
    // Filtro comandi  
    if (message.startsWith('Hey bot, ')) {  
        const userRequest = message.replace('Hey bot, ', '');  
        bot.chat('Analisi richiesta...');  
  
        // 1. Raccogli Dati  
        const state = getBotState(bot);  
          
        // 2. Costruisci Prompt  
        const prompt = `  
        You are a Minecraft Bot. Current State: ${JSON.stringify(state)}.  
        User Request: "${userRequest}".  
        Generate a JSON sequence of actions to fulfill the request.  
        Available actions: [{"type": "move", "x": 10, "y": 64, "z": 10}, {"type": "chat", "message": "text"}].  
        Strictly output ONLY a JSON array.  
        `;  
  
        // 3. Interroga Llama  
        console.log('[System] Asking Llama...');  
        const plan = await queryLlama(prompt);  
  
        // 4. Esegui Piano  
        if (Array.isArray(plan) && plan.length > 0) {  
            console.log('[System] Plan received:', plan);  
            brain.enqueuePlan(plan);  
        } else {  
            bot.chat('Non ho capito cosa fare.');  
        }  
    }  
});  
  
bot.on('error', console.error);  
## Note per l'implementazione  
1. **Validazione JSON:** Llama 3.1 è potente, ma assicurati che il System Prompt sia molto rigoroso sull'output JSON puro.  
2. **Validazione JSON:** Llama 3.1 è potente, ma assicurati che il System Prompt sia molto rigoroso sull'output JSON puro.  
3. **Validazione JSON:** Llama 3.1 è potente, ma assicurati che il System Prompt sia molto rigoroso sull'output JSON puro.  
4. **Pathfinder:** Questa struttura assume che il server Minecraft permetta il cheat mode o sia un ambiente controllato, altrimenti il bot potrebbe essere kickato se il pathfinding invia troppi pacchetti.  
5. **Pathfinder:** Questa struttura assume che il server Minecraft permetta il cheat mode o sia un ambiente controllato, altrimenti il bot potrebbe essere kickato se il pathfinding invia troppi pacchetti.  
6. **Pathfinder:** Questa struttura assume che il server Minecraft permetta il cheat mode o sia un ambiente controllato, altrimenti il bot potrebbe essere kickato se il pathfinding invia troppi pacchetti.  
7. **Timeout:** Le chiamate HTTP a Ollama possono durare vari secondi. L'utilizzo di await queryLlama nel listener della chat è accettabile perché non blocca il BotBrain (che gira su eventi separati), ma ricorda che il bot sarà "sordo" a nuovi comandi chat finché Llama non risponde a quello precedente (a meno che non gestisci la coda delle richieste chat, ma per ora va bene così).  
8. **Timeout:** Le chiamate HTTP a Ollama possono durare vari secondi. L'utilizzo di await queryLlama nel listener della chat è accettabile perché non blocca il BotBrain (che gira su eventi separati), ma ricorda che il bot sarà "sordo" a nuovi comandi chat finché Llama non risponde a quello precedente (a meno che non gestisci la coda delle richieste chat, ma per ora va bene così).  
9. **Timeout:** Le chiamate HTTP a Ollama possono durare vari secondi. L'utilizzo di await queryLlama nel listener della chat è accettabile perché non blocca il BotBrain (che gira su eventi separati), ma ricorda che il bot sarà "sordo" a nuovi comandi chat finché Llama non risponde a quello precedente (a meno che non gestisci la coda delle richieste chat, ma per ora va bene così).  
