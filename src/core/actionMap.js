const { goals } = require('mineflayer-pathfinder');  
  
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
                    bot.removeListener('goal_reached', onSuccess);  
                    bot.removeListener('path_update', onPathUpdate); 
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
                        resolve();  
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