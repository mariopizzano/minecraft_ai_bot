const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const toolPlugin = require('mineflayer-tool').plugin
const axios = require('axios')

// --- CONFIGURAZIONE ---
const CONFIG = {
  host: 'localhost',
  port: 25565,
  username: 'AI_Final',
  model: 'llama3.1',
  api_url: 'http://localhost:11434/api/generate',
  ctx: 1024,
  timeout: 10000
}

const bot = mineflayer.createBot({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  version: false
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(toolPlugin)

// --- STATO ---
let priorityCommand = null
let activeAiController = null
let isActionInProgress = false // IL VERO SEMAFORO FISICO

// --- SYSTEM PROMPT ---
const SYSTEM_PROMPT = `
You are a Minecraft Agent.
GOAL: Execute the user's "ORDER".

API COMMANDS:
- {"cmd": "come", "target": "player"}
- {"cmd": "stop"}
- {"cmd": "dig", "block": "oak_log"}
- {"cmd": "follow", "target": "player"}
- {"cmd": "move", "x": 10, "z": 0} (Explore only if ORDER is None)
- {"cmd": "idle"}

RULES:
1. If ORDER contains "vieni" -> {"cmd": "come"}
2. If ORDER contains "stop" -> {"cmd": "stop"}
3. If ORDER contains "scava" -> {"cmd": "dig"}
4. If ORDER is "None" -> {"cmd": "idle"}
`

// --- EVENTI ---
bot.on('spawn', () => {
  console.log('[SYSTEM] Bot Online. Avvio loop decisionale...')
  const moves = new Movements(bot)
  bot.pathfinder.setMovements(moves)
  
  // AVVIA IL PRIMO CICLO DI PENSIERO
  setTimeout(decisionLoop, 3000)
})

bot.on('chat', (username, message) => {
  if (username === CONFIG.username) return
  console.log(`[CHAT] ${username}: ${message}`)
  
  // 1. ABORT AI: Smetti di pensare al passato
  if (activeAiController) {
      activeAiController.abort()
      activeAiController = null
  }

  // 2. ABORT FISICA: Fermati subito
  bot.pathfinder.stop()
  isActionInProgress = false // Forza il reset del semaforo
  
  // 3. SETTA IL NUOVO ORDINE
  priorityCommand = `${username} says: "${message}"`
  
  // 4. FORZA UN NUOVO CICLO DI PENSIERO IMMEDIATO
  // (Senza aspettare il timeout del loop precedente)
  decisionLoop()
})

// --- MODULO AI ---
async function askBrain() {
  const p = bot.entity.position
  const state = {
    hp: Math.round(bot.health),
    pos: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
    inventory: bot.inventory.items().map(i => i.name).slice(0, 5),
    ORDER: priorityCommand || "None"
  }

  activeAiController = new AbortController()
  
  try {
    const response = await axios.post(CONFIG.api_url, {
      model: CONFIG.model,
      prompt: `${SYSTEM_PROMPT}\nSTATE: ${JSON.stringify(state)}`,
      stream: false,
      format: "json",
      options: { temperature: 0.1, num_ctx: CONFIG.ctx }
    }, {
      signal: activeAiController.signal,
      timeout: CONFIG.timeout
    })
    
    activeAiController = null
    return JSON.parse(response.data.response)

  } catch (e) {
    activeAiController = null
    if (axios.isCancel(e)) return null // Se annullato, ritorna null
    return { cmd: "idle" } // Fallback
  }
}

// --- ESECUZIONE FISICA (BLOCCANTE) ---
async function execute(decision) {
  if (!decision || !decision.cmd) return

  console.log(`[EXEC] ${decision.cmd.toUpperCase()}`)
  isActionInProgress = true // ALZA IL SEMAFORO ROSSO

  try {
    switch (decision.cmd) {
      case 'come':
        const target = Object.values(bot.players).find(p => p.username !== CONFIG.username)?.entity
        if (target) {
            bot.chat("Arrivo.")
            priorityCommand = null // Ordine preso in carico
            await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1))
        }
        break

      case 'stop':
        bot.pathfinder.stop()
        priorityCommand = null
        break

      case 'dig':
        const blockName = decision.block || "oak_log"
        const blocks = bot.findBlocks({ matching: b => b.name.includes(blockName), maxDistance: 32, count: 1 })
        if (blocks.length > 0) {
            bot.chat("Scavo.")
            priorityCommand = null
            const targetBlock = bot.blockAt(blocks[0])
            await bot.tool.equipForBlock(targetBlock)
            await bot.dig(targetBlock)
        } else {
            bot.chat("Non trovo blocchi.")
            priorityCommand = null
        }
        break

      case 'move':
        if (!priorityCommand) {
             const x = bot.entity.position.x + (decision.x || 0)
             const z = bot.entity.position.z + (decision.z || 0)
             await bot.pathfinder.goto(new goals.GoalNear(x, bot.entity.position.y, z, 1))
        }
        break
        
      case 'idle':
         // Piccolo delay per non spammare la CPU
         await new Promise(r => setTimeout(r, 1000))
         break
    }
  } catch (err) {
    console.log(`[FAIL] ${err.message}`)
  }
  
  isActionInProgress = false // ABBASSA IL SEMAFORO VERDE
}

// --- IL CUORE DEL SISTEMA (LOOP RICORSIVO) ---
async function decisionLoop() {
  // 1. Se il bot sta lavorando, NON disturbare. Riprova tra poco.
  if (isActionInProgress || bot.pathfinder.isMoving()) {
      setTimeout(decisionLoop, 500)
      return
  }

  // 2. Chiedi al cervello
  // Nota: Se askBrain ritorna null (perché annullato dalla chat), non facciamo nulla.
  const decision = await askBrain()
  
  // 3. Esegui (Questo bloccherà il codice finché l'azione non finisce)
  if (decision) {
      await execute(decision)
  }

  // 4. Appena finito, ricomincia subito
  setTimeout(decisionLoop, 100)
}