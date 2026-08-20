from pathlib import Path
import unittest


class MobileScrollRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = (Path(__file__).resolve().parents[1] / "frontend" / "src" / "index.css").read_text(encoding="utf-8")

    def test_root_layers_do_not_become_hidden_scroll_containers(self):
        compact = "".join(self.css.split())
        self.assertNotIn("html,body,#root{max-width:100%;overflow-x:hidden", compact)
        self.assertIn("html{scroll-behavior:smooth;min-height:100%;overflow-x:visible;overflow-y:auto", compact)
        self.assertIn("#root{min-height:100%;overflow:visible", compact)

    def test_horizontal_clipping_is_scoped_to_visual_shell(self):
        compact = "".join(self.css.split())
        self.assertIn(".dc-v3,.public-shell{max-width:100%;overflow-x:clip", compact)
        self.assertIn("overscroll-behavior-y:auto", compact)


if __name__ == "__main__":
    unittest.main()
