const mineflayer = require("mineflayer");
const { pathfinder, Movements } = require("mineflayer-pathfinder");
const { BotBrain } = require("./src/core/fsm");
const { queryLlama } = require("./src/services/ollama");
const { getBotState } = require("./src/services/perception");

const bot = mineflayer.createBot({
  host: "localhost",
  port: 25565,
  username: "AI_Engineer",
});

// Carica plugin
bot.loadPlugin(pathfinder);

let brain;

bot.once("spawn", () => {
  // Inizializza movimenti standard
  const mcData = require("minecraft-data")(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMove);

  // Inizializza il cervello
  brain = new BotBrain(bot);
  console.log("[System] Bot spawned and Brain active.");
});

bot.on("chat", async (username, message) => {
  if (username === bot.username) return;

  // 1. Raccogli Dati
  const state = getBotState(bot, username);

  // 2. Costruisci Prompt
  const prompt = `  
        Current State: ${JSON.stringify(state)}.  
        User Request: "${message}".  
        `;

  // 3. Interroga Llama
  console.log("[System] Asking Llama...");
  const plan = await queryLlama(prompt);

  // 4. Esegui Piano
  try {
    let actions = [];

    if (Array.isArray(plan)) actions = plan;
    else if (plan && typeof plan === "object") actions = [plan];
    else if (typeof plan === "string") {
      const parsed = JSON.parse(plan);
      actions = Array.isArray(parsed) ? parsed : [parsed];
    }

    if (actions.length > 0 && actions.some((a) => a && a.type)) {
      console.log(`[System] Enqueuing ${actions.length} action(s)`);
      brain.enqueuePlan(actions);
    } else {
      bot.chat("Nessuna azione da eseguire.");
    }
  } catch (e) {
    console.error("[System] Plan processing error:", e.message);
    bot.chat("Errore nel piano ricevuto.");
  }
});

bot.on("error", console.error);
