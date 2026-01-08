const EventEmitter = require("events");
const { createActionExecutor } = require("./actionMap");

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
    console.log("[FSM] EMERGENCY OVERRIDE TRIGGERED");
    this.queue = []; // Opzionale: cancella piano corrente o lo mette in pausa
    this.queue.unshift(action);
    this.bot.pathfinder.setGoal(null); // Stop immediato movimento
    this.isBusy = false; // Reset flag per forzare esecuzione immediata
    this.processNext();
  }

  async processNext() {
    if (this.isBusy) return;
    if (this.queue.length === 0) {
      console.log("[FSM] Queue empty. Idling.");
      return;
    }

    this.isBusy = true;
    const task = this.queue.shift();

    try {
      const actionFn = this.executor[task.type] || this.executor.fallback;
      await actionFn(task);
    } catch (error) {
      console.error("[FSM] Execution Error:", error);
    } finally {
      this.isBusy = false;
      // Ricorsione asincrona tramite event loop
      setImmediate(() => this.processNext());
    }
  }

  setupInterrupts() {
    // Esempio: Se prendiamo danno, scatta l'allarme
    this.bot.on("entityHurt", (entity) => {
      if (entity === this.bot.entity) {
        /* this.emergencyOverride({
                    type: "moveToPlayer",
                    playerName: "justmammt"
                })*/
        console.log("[Interrupt] Bot was hurt!");
      }
    });

    this.bot.on("chat", async (username, message) => {
      if (message == "stop") {
        this.emergencyOverride({});
        console.log("[Interrupt] Forced stop called.");
      }
    });
  }
}

module.exports = { BotBrain };
