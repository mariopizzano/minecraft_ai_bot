const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const toolPlugin = require('mineflayer-tool').plugin
const axios = require('axios')

// --- CONFIGURAZIONE ---
const CONFIG = {
  host: 'localhost',
  port: 25565,
  username: 'AI_Engineer',
  model: 'llama3.1',
  api_url: 'http://localhost:11434/api/generate',
  ctx: 2048, // Aumentato per gestire meglio lo stato
  timeout: 15000
}

const bot = mineflayer.createBot({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  version: false // Auto-detect
})

// Caricamento plugin
bot.loadPlugin(pathfinder)
bot.loadPlugin(toolPlugin)
bot.loadPlugin(collectBlock)

// --- STATO GLOBALE ---
let currentGoal = null // L'obiettivo di alto livello (es: "Ottieni legna")
let isBusy = false     // Flag di stato fisico
let interruptSignal = false // Segnale per abortire l'azione fisica corrente

// --- SYSTEM PROMPT OTTIMIZZATO ---
// Definiamo un output JSON rigoroso. L'AI decide COSA fare, non COME muoversi.
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

LOGIC RULES:
- If user wants a Crafting Table but you have no wood -> Action is GATHER oak_log.
- If user wants a Crafting Table and you HAVE wood -> (Next module we will implement crafting). For now, IDLE.
- Always check INVENTORY before deciding.
`

// --- GESTIONE EVENTI ---
bot.on('spawn', () => {
  console.log('[SYSTEM] Engineering Bot Online.')
  const moves = new Movements(bot)
  bot.pathfinder.setMovements(moves)
  
  // Avvio loop decisionale principale
  mainLoop()
})

bot.on('chat', (username, message) => {
  if (username === CONFIG.username) return
  console.log(`[CMD] ${username}: ${message}`)
  
  // 1. Interrupt Immediato
  if (isBusy) {
    interruptSignal = true
    bot.pathfinder.stop()
    bot.collectBlock.cancelTask() // Funzione critica di collectblock
    console.log('[SYSTEM] Interruzione forzata.')
  }

  // 2. Aggiornamento Obiettivo
  currentGoal = message
})

// --- MOTORE INFERENZIALE (AI) ---
async function analyzeSituation() {
  if (!currentGoal) return { action: "idle" }

  // Snapshot dello stato
  const inventory = bot.inventory.items().reduce((acc, item) => {
    acc[item.name] = (acc[item.name] || 0) + item.count
    return acc
  }, {})

  const nearbyBlocks = bot.findBlocks({ 
    matching: (blk) => ['oak_log', 'birch_log'].includes(blk.name),
    maxDistance: 16, 
    count: 1 
  }).length > 0 ? "Wood detected nearby" : "No wood nearby"

  const state = {
    hp: bot.health,
    inventory: inventory,
    environment_scan: nearbyBlocks,
    USER_ORDER: currentGoal
  }

  try {
    const response = await axios.post(CONFIG.api_url, {
      model: CONFIG.model,
      prompt: `${SYSTEM_PROMPT}\nCURRENT STATE: ${JSON.stringify(state)}`,
      stream: false,
      format: "json",
      options: { temperature: 0.1, num_ctx: CONFIG.ctx }
    }, { timeout: CONFIG.timeout })
    
    return JSON.parse(response.data.response)
  } catch (e) {
    console.error(`[AI ERROR] ${e.message}`)
    return { action: "idle" }
  }
}

// --- LIVELLO ESECUTIVO (PRIMITIVE FISICHE) ---
async function executeAction(plan) {
  if (interruptSignal) return
  isBusy = true

  console.log(`[EXEC] Action: ${plan.action} | Target: ${plan.target || 'N/A'}`)

  try {
    switch (plan.action) {
      case 'gather':
        const blockType = bot.registry.blocksByName[plan.target]
        if (!blockType) {
            bot.chat(`Non conosco il blocco ${plan.target}`)
            break
        }

        // Cerca il blocco nel mondo
        const block = bot.findBlock({
          matching: blockType.id,
          maxDistance: 64
        })

        if (block) {
          bot.chat(`Vado a prendere ${plan.target}...`)
          // collectBlock gestisce pathfinding, equipaggiamento tool e scavo in automatico
          await bot.collectBlock.collect(block)
          bot.chat(`Preso ${plan.target}.`)
        } else {
          bot.chat(`Non trovo ${plan.target} nelle vicinanze.`)
          // Qui si potrebbe implementare una routine di esplorazione
        }
        break

      case 'stop':
        bot.pathfinder.stop()
        currentGoal = null
        bot.chat("Fermo.")
        break
        
      case 'idle':
        // Nessuna operazione costosa
        await new Promise(r => setTimeout(r, 500))
        break
    }
  } catch (err) {
    // Se l'errore è dovuto all'interrupt manuale, è previsto.
    if (interruptSignal) {
        console.log('[SYSTEM] Azione interrotta dall\'utente.')
    } else {
        console.log(`[FAIL] Errore esecuzione: ${err.message}`)
        bot.chat("Ho avuto un problema durante l'azione.")
    }
  }

  // Reset stati
  isBusy = false
  interruptSignal = false
}

// --- LOOP PRINCIPALE ---
async function mainLoop() {
  while (true) {
    // 1. Se siamo liberi, pensiamo
    if (!isBusy) {
        // Se non c'è un ordine, attendi input (risparmio CPU/GPU)
        if (!currentGoal) {
            await new Promise(r => setTimeout(r, 1000))
            continue
        }

        const decision = await analyzeSituation()
        
        // Eseguiamo solo se non siamo stati interrotti durante il pensiero
        if (!interruptSignal) {
            await executeAction(decision)
        }
    }
    
    // Piccolo throttle per stabilità del loop
    await new Promise(r => setTimeout(r, 100))
  }
}