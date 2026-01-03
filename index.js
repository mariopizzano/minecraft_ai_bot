const mineflayer = require('mineflayer');  
const { pathfinder, Movements } = require('mineflayer-pathfinder');  
const { BotBrain } = require('./src/core/fsm');  
const { queryLlama } = require('./src/services/ollama');  
const { getBotState } = require('./src/services/perception');  
  
const bot = mineflayer.createBot({  
    host: 'localhost',  
    port: 25565,  
    username: 'AI_Engineer'  
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
      
 
        bot.chat('Analisi richiesta...');  
  
        // 1. Raccogli Dati  
        const state = getBotState(bot);  
          
        // 2. Costruisci Prompt  
        const prompt = `  
        Current State: ${JSON.stringify(state)}.  
        User Request: "${message}".  
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
    
});  
  
bot.on('error', console.error);  