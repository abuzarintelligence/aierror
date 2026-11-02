# Run: pip install -e ../../packages/python && OPENAI_API_KEY=... python demo.py
from ai_error import ai_error
from pricing import parse_price

safe_parse_price = ai_error(parse_price, name="parse_price", max_attempts=2)

print(safe_parse_price({"amount": "$10"}))
print(safe_parse_price({"total": "$10"}))  # KeyError -> self-healed
