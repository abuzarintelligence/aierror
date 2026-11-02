function parsePrice(order) {
  return Number(order.amount.replace('$', '')) * 1.2; // breaks when "amount" is missing
}
module.exports = { parsePrice };
