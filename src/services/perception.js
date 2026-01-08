function getBotState(bot, inquirer) {
  // Filtriamo solo ciò che serve per ridurre i token
  const inventory = bot.inventory.items().map((item) => ({
    name: item.name,
    count: item.count,
  }));

  const position = {
    x: Math.floor(bot.entity.position.x),
    y: Math.floor(bot.entity.position.y),
    z: Math.floor(bot.entity.position.z),
  };

  // Rileva nemici entro 15 blocchi
  const threats = Object.values(bot.entities)
    .filter(
      (e) => e.type === "mob" && e.position.distanceTo(bot.entity.position) < 15
    )
    .map((e) => ({
      type: e.name,
      dist: Math.floor(e.position.distanceTo(bot.entity.position)),
    }));

  return {
    health: bot.health,
    food: bot.food,
    position: position,
    inventory: inventory,
    nearby_threats: threats,
    is_day: bot.time.timeOfDay < 13000,
    inquirer: inquirer,
  };
}

module.exports = { getBotState };
