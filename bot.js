const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const axios = require('axios')

// --- CONFIGURAZIONE ---
const CONFIG = {
  mc_host: 'localhost',
  mc_port: 25565,
  bot_name: 'AI_Agent',
  
  // Configurazione Ollama
  ollama_endpoint: 'http://localhost:11434/api/generate',
  ollama_model: 'llama3.1', // Assicurati di aver fatto 'ollama pull llama3.1'
  ollama_ctx: 2048,        // Contesto limitato per velocità
  
  // Loop di gioco (ms)
  loop_interval: 15000     // 15s: Tempo sicuro per inferenza su GPU consumer
}

// Inizializzazione Bot
const bot = mineflayer.createBot({
  host: CONFIG.mc_host,
  port: CONFIG.mc_port,
  username: CONFIG.bot_name,
  version: false // Auto-detect versione
})

bot.loadPlugin(pathfinder)

// Variabili di Stato
let isThinking = false
let lastChatRequest = "" // Buffer per memorizzare l'ultimo comando chat

// --- GESTIONE EVENTI ---
bot.on('spawn', () => {
  console.log(`[INIT] ${CONFIG.bot_name} connesso. Modello AI: ${CONFIG.ollama_model}`)
  
  // Setup Pathfinding
  const defaultMove = new Movements(bot)
  bot.pathfinder.setMovements(defaultMove)

  // Warmup e avvio loop
  setTimeout(() => {
    console.log('[SYSTEM] Loop Decisionale Avviato.')
    bot.chat('AI Online. In attesa di comandi.')
    setInterval(aiGameLoop, CONFIG.loop_interval)
  }, 3000)
})

bot.on('chat', (username, message) => {
  if (username === CONFIG.bot_name) return
  console.log(`[USER INPUT] ${username}: ${message}`)
  // Salviamo il messaggio per iniettarlo nel prossimo prompt
  lastChatRequest = `${username} asks: "${message}"`
})

bot.on('error', (err) => console.log(`[ERROR] ${err.message}`))
bot.on('kicked', (reason) => console.log(`[KICKED] ${reason}`))


// --- 1. MODULO PERCEZIONE (INPUT) ---
function getSensoryInput() {
  const p = bot.entity.position
  
  // Scansione visiva limitata (Raggio 4)
  const nearbyBlocks = []
  for (let x = -4; x <= 4; x+=2) { // Step 2 per ottimizzare
    for (let y = 0; y <= 1; y++) {
      for (let z = -4; z <= 4; z+=2) {
        const block = bot.blockAt(p.offset(x, y, z))
        if (block && block.name !== 'air' && !nearbyBlocks.includes(block.name)) {
          nearbyBlocks.push(block.name)
        }
      }
    }
  }

  return {
    status: {
      health: Math.round(bot.health),
      food: Math.round(bot.food),
      day: bot.time.timeOfDay < 13000
    },
    position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
    inventory: bot.inventory.items().map(i => i.name).slice(0, 5),
    surroundings: nearbyBlocks.slice(0, 8),
    latest_instruction: lastChatRequest || "None (Explore or Survive)"
  }
}

// --- 2. MODULO RAGIONAMENTO (LLM) ---
async function queryBrain(state) {
  // FEW-SHOT PROMPTING: Esempi espliciti con "reasoning" incluso
  const prompt = `
You are a Minecraft AI. 
GOAL: Obey user instructions. If none, explore.

CURRENT STATE:
${JSON.stringify(state)}

INSTRUCTIONS:
- Return a SINGLE JSON object.
- You MUST include a "reasoning" field explaining your logic.

AVAILABLE ACTIONS (Examples):
1. {"type": "chat", "msg": "Hello!", "reasoning": "The user said hi, I am replying."}
2. {"type": "move", "x": 5, "z": 0, "reasoning": "User asked to move forward."}
3. {"type": "jump", "reasoning": "User asked to jump."}
4. {"type": "follow", "target": "Steve", "reasoning": "User asked to follow them."}

Output JSON only:
`

  try {
    const response = await axios.post(CONFIG.ollama_endpoint, {
      model: CONFIG.ollama_model,
      prompt: prompt,
      stream: false,
      format: "json", // Forza output strutturato nativo di Llama 3
      options: { 
        temperature: 0.1, // Determinismo massimo
        num_ctx: CONFIG.ollama_ctx 
      }
    })

    const decision = JSON.parse(response.data.response)
    return decision
  } catch (e) {
    console.error(`[AI FAIL] ${e.message}`)
    return null
  }
}

// --- 3. MODULO ATTUAZIONE (OUTPUT) ---
async function execute(cmd) {
  if (!cmd) return

  // Fallback per il campo reasoning se l'AI usa chiavi diverse
  const thought = cmd.reasoning || cmd.reason || cmd.thought || "No reasoning provided";
  
  console.log(`[THOUGHT] ${thought}`)
  console.log(`[ACTION] ${cmd.type} ${JSON.stringify(cmd).replace(/"type":".*?",/,'').replace(/"reasoning":".*?"/,'')}`)

  // Pulisci l'ultima richiesta chat processata
  if (lastChatRequest) lastChatRequest = ""

  try {
    switch (cmd.type) {
      case 'chat':
        if (cmd.msg) bot.chat(cmd.msg)
        break
        
      case 'jump':
        bot.setControlState('jump', true)
        setTimeout(() => bot.setControlState('jump', false), 500)
        break

      case 'move':
        // Coordinate relative -> assolute
        const goal = new goals.GoalNear(
          bot.entity.position.x + (cmd.x || 0),
          bot.entity.position.y,
          bot.entity.position.z + (cmd.z || 0),
          1
        )
        await bot.pathfinder.goto(goal)
        break

      case 'follow':
        // Cerca il player target o il primo disponibile
        let targetName = cmd.target
        
        // Se il target non è specificato o è generico, prendi il primo player non-bot
        if (!targetName || targetName === 'player' || targetName === 'me') {
           const playerNames = Object.keys(bot.players).filter(n => n !== CONFIG.bot_name)
           targetName = playerNames[0]
        }

        const targetEntity = bot.players[targetName]?.entity
        
        if (targetEntity) {
          bot.chat(`Arrivo, ${targetName}!`)
          await bot.pathfinder.goto(new goals.GoalFollow(targetEntity, 2))
        } else {
          console.log(`[WARN] Player '${targetName}' non trovato o troppo lontano.`)
          bot.chat("Non vedo nessuno da seguire qui vicino.")
        }
        break
        
      default:
        console.log(`[WARN] Azione sconosciuta: ${cmd.type}`)
    }
  } catch (err) {
    console.log(`[EXECUTION ERROR] ${err.message}`)
    bot.chat("Non riesco a completare l'azione.")
  }
}

// --- MAIN LOOP ---
async function aiGameLoop() {
  if (isThinking) return
  isThinking = true

  const state = getSensoryInput()
  
  console.log('--- Analisi Stato ---')
  const decision = await queryBrain(state)
  
  if (decision) {
    await execute(decision)
  }

  isThinking = false
}