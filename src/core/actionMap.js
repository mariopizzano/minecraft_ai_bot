const { goals } = require("mineflayer-pathfinder");

// Factory function per avere accesso all'istanza 'bot'
function createActionExecutor(bot) {
  return {
    move: async (params) => {
      const { x, y, z } = params;
      console.log(`[Action] Moving to ${x}, ${y}, ${z}`);
      const goal = new goals.GoalBlock(x, y, z);
      bot.pathfinder.setGoal(goal);

      return new Promise((resolve, reject) => {
        const cleanUp = () => {
          bot.removeListener("goal_reached", onSuccess);
          bot.removeListener("path_update", onPathUpdate);
        };

        const onSuccess = () => {
          cleanUp();
          console.log("[Action] Move complete.");
          resolve();
        };

        const onPathUpdate = (r) => {
          if (r.status === "noPath") {
            cleanUp();
            console.log("[Action] No path found.");
            resolve();
          }
        };

        bot.once("goal_reached", onSuccess);
        bot.on("path_update", onPathUpdate);
      });
    },

    moveToPlayer: async (params) => {
      const { playerName } = params;

      if (!playerName) {
        console.log("[Action] No player name provided for moveToPlayer");
        return Promise.resolve();
      }

      const targetPlayer = Object.values(bot.entities).find(
        (entity) =>
          entity.type === "player" &&
          entity.username &&
          entity.username.toLowerCase() === playerName.toLowerCase()
      );

      if (!targetPlayer) {
        console.log(`[Action] Player "${playerName}" not found nearby`);
        bot.chat(`Non riesco a trovare ${playerName} nelle vicinanze`);
        return Promise.resolve();
      }

      const targetPos = targetPlayer.position;
      console.log(
        `[Action] Moving to player ${playerName} at ${Math.floor(
          targetPos.x
        )}, ${Math.floor(targetPos.y)}, ${Math.floor(targetPos.z)}`
      );

      const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);

      bot.pathfinder.setGoal(goal);

      return new Promise((resolve, reject) => {
        let cleanupDone = false;
        let checkInterval;
        let playerCheckInterval;

        const cleanUp = () => {
          if (cleanupDone) return;
          cleanupDone = true;

          bot.removeListener("goal_reached", onSuccess);
          bot.removeListener("path_update", onPathUpdate);

          if (checkInterval) clearInterval(checkInterval);
          if (playerCheckInterval) clearInterval(playerCheckInterval);
        };

        const onSuccess = () => {
          cleanUp();
          console.log(`[Action] Reached player ${playerName}`);
          bot.chat(`Sono arrivato da te, ${playerName}!`);
          resolve();
        };

        const onPathUpdate = (r) => {
          if (r.status === "noPath") {
            cleanUp();
            console.log("[Action] No path found to player");
            bot.chat(
              `Non riesco a trovare un percorso per raggiungere ${playerName}`
            );
            resolve();
          }
        };

        // Controlla periodicamente se il player si è mosso
        const updatePlayerPosition = () => {
          const currentPlayer = Object.values(bot.entities).find(
            (entity) =>
              entity.type === "player" &&
              entity.username &&
              entity.username.toLowerCase() === playerName.toLowerCase()
          );

          if (!currentPlayer) {
            console.log(`[Action] Player ${playerName} disappeared`);
            cleanUp();
            bot.chat(`${playerName} non è più nelle vicinanze`);
            resolve();
            return;
          }

          // Se il player si è mosso significativamente (> 5 blocchi), aggiorna il goal
          const playerPos = currentPlayer.position;
          const distanceMoved = playerPos.distanceTo(targetPos);

          if (distanceMoved > 5) {
            console.log(
              `[Action] Player moved ${distanceMoved.toFixed(
                1
              )} blocks, updating goal`
            );
            const newGoal = new goals.GoalNear(
              playerPos.x,
              playerPos.y,
              playerPos.z,
              2
            );
            bot.pathfinder.setGoal(newGoal);
          }
        };

        bot.once("goal_reached", onSuccess);
        bot.on("path_update", onPathUpdate);

        // Controlla ogni secondo se il player si è mosso
        playerCheckInterval = setInterval(updatePlayerPosition, 1000);

        // Timeout di sicurezza dopo 30 secondi
        setTimeout(() => {
          if (!cleanupDone) {
            console.log("[Action] MoveToPlayer timeout after 30 seconds");
            cleanUp();
            bot.chat(`Ci ho messo troppo tempo per raggiungere ${playerName}`);
            resolve();
          }
        }, 30000);
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
    },
  };
}

module.exports = { createActionExecutor };
