import importlib
import json
import math
import pathlib
import sys
import tempfile
import unittest
import uuid

from ai_error import ai_error, AIHealError, redact


def _fake(reply):
    return lambda system, prompt: reply


class AIErrorTests(unittest.TestCase):
    def _module(self, source):
        d = pathlib.Path(tempfile.mkdtemp())
        name = "buggy_" + uuid.uuid4().hex[:8]
        (d / f"{name}.py").write_text(source)
        sys.path.insert(0, str(d))
        return d, importlib.import_module(name)

    def test_no_error_passes_through(self):
        @ai_error(complete=_fake("{}"))
        def add(a, b):
            return a + b
        self.assertEqual(add(2, 3), 5)

    def test_heals_and_retries(self):
        d, mod = self._module("def divide(a, b):\n    return a / b\n")
        fixed = "def divide(a, b):\n    if a is None or b is None:\n        return float('nan')\n    return a / b"
        reply = json.dumps({"canFix": True, "replacement": fixed, "explanation": "guard None"})
        f = ai_error(mod.divide, name="divide", allowed_roots=[str(d)], state_dir=str(d / ".ai-error"), complete=_fake(reply))
        self.assertTrue(math.isnan(f(None, 1)))
        self.assertIn("a is None", (d / (mod.__name__ + ".py")).read_text())

    def test_unfixable_gives_advice(self):
        d, mod = self._module("def divide(a, b):\n    return a / b\n")
        reply = json.dumps({"canFix": False, "replacement": None, "userAdvice": "Pass numbers, not None."})
        f = ai_error(mod.divide, name="divide", allowed_roots=[str(d)], state_dir=str(d / ".ai-error"), complete=_fake(reply))
        with self.assertRaises(AIHealError) as ctx:
            f(None, 1)
        self.assertEqual(ctx.exception.code, "UNFIXABLE")
        self.assertIn("Pass numbers", str(ctx.exception))

    def test_redact_removes_keys(self):
        out = redact("key sk-abcdefghijklmnopqrstuvwxyz123456", [])
        self.assertNotIn("sk-abcdef", out)


if __name__ == "__main__":
    unittest.main()
