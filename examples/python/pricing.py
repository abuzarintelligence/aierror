def parse_price(order):
    return float(order["amount"].replace("$", "")) * 1.2  # breaks when "amount" is missing
