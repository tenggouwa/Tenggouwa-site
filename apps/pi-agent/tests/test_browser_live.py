"""Opt-in Chromium smoke for the Pi execution node.

Run only on the Pi after setting ``PI_AGENT_BROWSER=1`` and
``RUN_PI_BROWSER_LIVE_TESTS=1``. It intentionally never runs in normal CI.
"""

import os
import unittest

from agent import executor


@unittest.skipUnless(os.environ.get("RUN_PI_BROWSER_LIVE_TESTS") == "1", "set RUN_PI_BROWSER_LIVE_TESTS=1")
class BrowserLiveSmoke(unittest.TestCase):
    def tearDown(self) -> None:
        executor._browser_stop()

    def test_navigate_and_snapshot(self) -> None:
        url = os.environ.get("PI_AGENT_BROWSER_LIVE_URL", "https://example.com")
        result = executor._run_browser({"action": "navigate", "url": url})
        self.assertEqual(result["rc"], 0, result["output"])
        self.assertIn("[标题]", result["output"])
        self.assertIn("[URL]", result["output"])
